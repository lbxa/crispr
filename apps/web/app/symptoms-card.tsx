"use client";

import { useId, useRef, useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { Badge } from "@crispr/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@crispr/ui/components/card";
import { Field, FieldGroup, FieldLabel } from "@crispr/ui/components/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@crispr/ui/components/input-group";
import styles from "./symptoms-card.module.css";

const EXAMPLES = ["Fatigue", "Headache", "Joint pain"] as const;

export function SymptomsCard() {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [symptoms, setSymptoms] = useState<readonly string[]>([]);

  function addSymptoms(value: string) {
    const entries = value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    setSymptoms((current) => {
      const seen = new Set(current.map((symptom) => symptom.toLowerCase()));
      return [
        ...current,
        ...entries.filter((entry) => {
          const key = entry.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      ];
    });
  }

  return (
    <Card className={styles.card}>
      <CardHeader>
        <CardTitle>
          <h2 id={`${id}-title`}>Symptoms</h2>
        </CardTitle>
        <CardDescription>Add what you’re experiencing.</CardDescription>
      </CardHeader>
      <CardContent className={styles.content}>
        <div
          className={styles.pills}
          role="group"
          aria-label="Example symptoms"
        >
          {EXAMPLES.filter(
            (example) =>
              !symptoms.some(
                (symptom) => symptom.toLowerCase() === example.toLowerCase(),
              ),
          ).map((example) => (
            <Badge
              key={example}
              variant="outline"
              className={styles.pill}
              render={<button type="button" />}
              aria-label={`Add ${example.toLowerCase()}`}
              onClick={() => addSymptoms(example)}
            >
              <PlusIcon data-icon="inline-start" aria-hidden="true" />
              {example}
            </Badge>
          ))}
        </div>
        <form
          aria-labelledby={`${id}-title`}
          onSubmit={(event) => {
            event.preventDefault();
            addSymptoms(draft);
            setDraft("");
            inputRef.current?.focus();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${id}-input`} className="sr-only">
                Add symptoms
              </FieldLabel>
              <InputGroup className={styles.inputGroup}>
                <InputGroupInput
                  ref={inputRef}
                  id={`${id}-input`}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="e.g. dizziness, nausea"
                  autoComplete="off"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    type="submit"
                    size="sm"
                    variant="secondary"
                    disabled={!draft.split(",").some((entry) => entry.trim())}
                  >
                    Add
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </Field>
          </FieldGroup>
        </form>
        {symptoms.length > 0 && (
          <ul className={styles.pills} aria-label="Your symptoms">
            {symptoms.map((symptom) => (
              <li key={symptom.toLowerCase()} className={styles.listItem}>
                <Badge
                  variant="secondary"
                  className={styles.pill}
                  render={<button type="button" />}
                  aria-label={`Remove ${symptom}`}
                  onClick={() => {
                    setSymptoms((current) =>
                      current.filter((entry) => entry !== symptom),
                    );
                    inputRef.current?.focus();
                  }}
                >
                  {symptom}
                  <XIcon data-icon="inline-end" aria-hidden="true" />
                </Badge>
              </li>
            ))}
          </ul>
        )}
        <span role="status" className="sr-only">
          {symptoms.length} {symptoms.length === 1 ? "symptom" : "symptoms"}{" "}
          added
        </span>
      </CardContent>
    </Card>
  );
}
