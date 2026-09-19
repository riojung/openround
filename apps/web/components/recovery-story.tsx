export interface RecoveryStoryIntervention {
  id: string;
  label: string;
  startedAt?: string;
  followedByLinkedRecheck?: boolean;
}

export interface RecoveryStoryModel {
  recovered: number;
  denominator: number;
  recoveryPercent: number | null;
  initialAccuracyPercent: number | null;
  initialCorrect?: number;
  initialResponses?: number;
  evidenceLabel: string;
  unresolvedCount: number;
  unresolvedNarrative: string;
  interventions: RecoveryStoryIntervention[];
  nextActionLabel: string;
  nextAction: string;
  highConfidenceWrong: number;
  correctButUnsure: number;
  smallSample: boolean;
  evidenceNote: string;
  synthetic?: boolean;
}

export function RecoveryStorySummary({ model }: { model: RecoveryStoryModel }) {
  return (
    <section
      aria-label={model.synthetic ? "Synthetic Recovery Story" : "Recovery Story"}
      className="recovery-story"
      data-synthetic={model.synthetic || undefined}
      data-testid="recovery-summary"
    >
      <div className="recovery-story-heading">
        <div>
          <p className="eyebrow">Recovery Story</p>
          <h2>What changed during this session</h2>
        </div>
        <span className="status-pill">
          {model.synthetic
            ? "Synthetic practice evidence · never saved"
            : "Session evidence, not long-term retention"}
        </span>
      </div>
      <div className="recovery-story-grid">
        <article>
          <span>What recovered</span>
          <strong>
            {model.denominator > 0 ? `${model.recovered}/${model.denominator}` : "Not measured"}
          </strong>
          <p>
            {model.recoveryPercent === null
              ? "No paired initial and recheck evidence was collected."
              : `${model.recoveryPercent}% of initially incorrect participants with both responses recovered via ${model.evidenceLabel}.`}
          </p>
        </article>
        <article>
          <span>What remains unresolved</span>
          <strong>{model.unresolvedCount}</strong>
          <p>{model.unresolvedNarrative}</p>
        </article>
        <article>
          <span>What the facilitator tried</span>
          <strong>{model.interventions.length}</strong>
          <p>
            {model.interventions.length
              ? model.interventions.map((item) => item.label).join(", ")
              : "No intervention was recorded."}
          </p>
        </article>
        <article>
          <span>Recommended next action</span>
          <strong>{model.nextActionLabel}</strong>
          <p>{model.nextAction}</p>
        </article>
      </div>
      <div className="recovery-comparison" aria-label="Initial accuracy and recovery evidence">
        <div>
          <span>Initial accuracy</span>
          <span className="recovery-bar" aria-hidden="true">
            <span style={{ width: `${model.initialAccuracyPercent ?? 0}%` }} />
          </span>
          <strong>
            {model.initialAccuracyPercent === null
              ? "Not measured"
              : typeof model.initialCorrect === "number" &&
                  typeof model.initialResponses === "number"
                ? `${model.initialCorrect}/${model.initialResponses} · ${model.initialAccuracyPercent}%`
                : `${model.initialAccuracyPercent}%`}
          </strong>
        </div>
        <div>
          <span>Recovered among paired initially incorrect responses</span>
          <span className="recovery-bar" aria-hidden="true">
            <span style={{ width: `${model.recoveryPercent ?? 0}%` }} />
          </span>
          <strong>
            {model.recoveryPercent === null ? "Not measured" : `${model.recoveryPercent}%`}
          </strong>
        </div>
      </div>
      {model.highConfidenceWrong > 0 || model.correctButUnsure > 0 ? (
        <p className="confidence-callout">
          <strong>Confidence contradiction:</strong> {model.highConfidenceWrong} high-confidence
          incorrect response{model.highConfidenceWrong === 1 ? "" : "s"}; {model.correctButUnsure}{" "}
          correct but unsure response
          {model.correctButUnsure === 1 ? "" : "s"}.
        </p>
      ) : null}
      {model.smallSample ? (
        <p className="notice">
          At least one recovery comparison has fewer than five paired responses.
        </p>
      ) : null}
      {model.interventions.length ? (
        <ol className="intervention-timeline" aria-label="Intervention timeline">
          {model.interventions.map((intervention) => (
            <li key={intervention.id}>
              <strong>{intervention.label}</strong>
              <span>
                {intervention.startedAt
                  ? new Date(intervention.startedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : model.synthetic
                    ? "Synthetic action"
                    : "Time unavailable"}
                {intervention.followedByLinkedRecheck ? " · followed by a linked recheck" : ""}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="muted">{model.evidenceNote}</p>
    </section>
  );
}
