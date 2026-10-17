"""End-to-end smoke test of a running backend: real server, data, language model, HTTPS.

    python3 backend/scripts/smoke_test.py                   # live API, full run (seconds with Gemini, ~2 min with Granite)
    python3 backend/scripts/smoke_test.py --quick           # skip the order (~5 s)
    python3 backend/scripts/smoke_test.py --url http://localhost:8000

Standard library only, so it runs without the backend's virtualenv. Exits non-zero if
any check fails. The unit and API tests (`bun run verify:backend`) cover the code with
a mini database; this checks the deployed system.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

DEFAULT_URL = "https://148-100-79-183.sslip.io"
ORDER_TIMEOUT = 300  # seconds; Granite takes ~1-2 min per order on the server, Gemini seconds


class CheckFailed(Exception):
    pass


class Client:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def request(self, method: str, path: str, body: dict | None = None, timeout: int = 60) -> tuple[int, bytes]:
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(
            self.base_url + path, data=data, method=method, headers={"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    def json(self, method: str, path: str, body: dict | None = None, expect: int = 200, timeout: int = 60):
        status, payload = self.request(method, path, body, timeout)
        if status != expect:
            raise CheckFailed(f"{method} {path} returned HTTP {status}, expected {expect}: {payload[:200]!r}")
        return json.loads(payload)


def expect(condition: bool, message: str) -> None:
    if not condition:
        raise CheckFailed(message)


def check_health(client: Client) -> str:
    expect(client.json("GET", "/health") == {"status": "ok"}, "/health did not return ok")
    return "API is up"


def check_panel(client: Client) -> str:
    diseases = client.json("GET", "/diseases")
    expect(len(diseases) == 24, f"expected 24 panel diseases, got {len(diseases)}")
    expect(all({"omim_id", "name", "gene", "inheritance"} <= d.keys() for d in diseases), "disease fields missing")
    return f"{len(diseases)} diseases"


def check_genomes(client: Client, state: dict) -> str:
    genomes = client.json("GET", "/genomes")
    expect(len(genomes) > 0, "no demo genomes on the server")
    expect(all(set(g) == {"id", "sample_id", "sex"} for g in genomes), "genome list exposes unexpected fields")
    state["genome"] = genomes[0]
    return f"{len(genomes)} genomes, none revealing what was planted"


def check_genome_vcf(client: Client, state: dict) -> str:
    genome = state["genome"]
    status, payload = client.request("GET", f"/genomes/{genome['id']}/genome.vcf")
    expect(status == 200, f"VCF download returned HTTP {status}")
    text = payload.decode()
    expect(text.startswith("##fileformat=VCF"), "download is not a VCF")
    header = next((line for line in text.splitlines() if line.startswith("#CHROM")), "")
    expect(header.endswith(genome["sample_id"]), "VCF sample column doesn't match the genome")
    records = sum(1 for line in text.splitlines() if line and not line.startswith("#"))
    expect(records > 100, f"only {records} variant records; expected a full panel genome")
    return f"{genome['sample_id']}: {records} variant records, {len(payload) // 1024} KB"


def check_fast_analysis(client: Client, state: dict) -> str:
    started = time.monotonic()
    report = client.json(
        "POST",
        f"/genomes/{state['genome']['id']}/analyze",
        {"symptoms": "recurrent fever and abdominal pain", "use_llm": False},
    )
    elapsed = time.monotonic() - started
    expect(report["symptoms"]["extraction"] == "keyword", "use_llm=false still used the language model")
    names = {term["name"] for term in report["symptoms"]["terms"]}
    expect({"Recurrent fever", "Abdominal pain"} <= names, f"symptoms not recognized: {sorted(names)}")
    expect(report["genome"]["variants_checked"] > 100, "analysis saw too few variants")
    expect(bool(report["disclaimer"]), "report has no disclaimer")
    return f"{report['conclusion']['status']} in {elapsed:.1f}s"


def place_order(client: Client) -> dict:
    for _ in range(10):
        status, payload = client.request("POST", "/orders")
        if status == 202:
            return json.loads(payload)
        expect(status == 429, f"POST /orders returned HTTP {status}: {payload[:200]!r}")
        time.sleep(15)  # other orders are running; wait for a slot
    raise CheckFailed("server stayed at its order limit for 150 s")


def check_order(client: Client) -> str:
    order = place_order(client)
    started = time.monotonic()
    while True:
        view = client.json("GET", f"/orders/{order['id']}")
        if view["status"] != "processing":
            break
        expect(time.monotonic() - started < ORDER_TIMEOUT, f"order still processing after {ORDER_TIMEOUT}s")
        time.sleep(5)
    elapsed = time.monotonic() - started
    expect(view["status"] == "ready", f"order failed: {view['error']}")
    report = view["report"]
    truth = client.json("GET", f"/orders/{order['id']}/truth")
    planted = truth["planted_disease"]
    findings = report["findings"]
    model = report["symptoms"]["extraction"]  # "keyword", or the model that read the symptoms
    if planted:
        # The genotype step is deterministic: a planted disease must always be found.
        found = [f for f in findings if f["omim_id"] == planted["omim_id"]]
        expect(bool(found), f"planted {planted['name']} was not found; findings: {[f['disease'] for f in findings]}")
        expect(found[0]["genotype"]["status"] == "affected", "planted disease not recognized as disease-causing")
        expect(bool(found[0]["crispr"]), "no CRISPR plan for the planted disease")
        # Ranking depends on the symptom text and Granite, so it's reported, not required.
        top = findings[0]["omim_id"] == planted["omim_id"] and findings[0]["tier"] == "likely"
        outcome = f"planted {planted['name']}: found, {'ranked first as likely' if top else 'NOT ranked first'}"
    else:
        outcome = f"control genome: {report['conclusion']['status']}"
    return f"{outcome}; symptoms read by {model}; {elapsed:.0f}s"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--quick", action="store_true", help="skip the order, which waits for the language model")
    args = parser.parse_args()

    client, state = Client(args.url), {}
    checks = [
        ("health", lambda: check_health(client)),
        ("disease panel", lambda: check_panel(client)),
        ("genome list", lambda: check_genomes(client, state)),
        ("genome download", lambda: check_genome_vcf(client, state)),
        ("fast analysis", lambda: check_fast_analysis(client, state)),
    ]
    if not args.quick:
        checks.append(("order with LLM", lambda: check_order(client)))

    print(f"Smoke testing {args.url}")
    failures = 0
    for name, check in checks:
        try:
            detail = check()
            print(f"  PASS  {name:<20} {detail}", flush=True)
        except (CheckFailed, KeyError, ValueError, OSError) as error:
            failures += 1
            print(f"  FAIL  {name:<20} {error}", flush=True)
            if name in ("health", "genome list"):
                break  # later checks depend on these
    print("All checks passed." if not failures else f"{failures} check(s) failed.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
