import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { configureOnceFromEnv, getLogger } =
      await import("@crispr/observability");
    configureOnceFromEnv("web");
    getLogger("web").info({ app_name: "web" }, "next_server_started");
  }
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getLogger } = await import("@crispr/observability");
    getLogger("web").error(
      {
        err: error,
        method: request.method,
        route: context.routePath,
        router: context.routerKind,
        outcome: "failed",
      },
      "next_request_failed",
    );
  }
};
