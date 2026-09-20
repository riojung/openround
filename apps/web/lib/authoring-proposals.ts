import type { AuthoringJob } from "@openround/contracts";

export interface AuthoringProposalSelection {
  selectedContentSlideIds: string[];
  selectedQuestionIds: string[];
}

export function defaultAuthoringProposalSelection(
  job: Pick<AuthoringJob, "output">,
): AuthoringProposalSelection {
  return {
    selectedContentSlideIds: job.output?.contentSlideProposals?.map(({ id }) => id) ?? [],
    selectedQuestionIds: job.output?.checkpointSet.questions.map(({ id }) => id) ?? [],
  };
}

export function toggleContentSlideProposal(
  job: Pick<AuthoringJob, "output">,
  selection: AuthoringProposalSelection | undefined,
  proposalId: string,
): AuthoringProposalSelection {
  const current = selection ?? defaultAuthoringProposalSelection(job);
  return {
    ...current,
    selectedContentSlideIds: current.selectedContentSlideIds.includes(proposalId)
      ? current.selectedContentSlideIds.filter((id) => id !== proposalId)
      : [...current.selectedContentSlideIds, proposalId],
  };
}

export function toggleQuestionProposal(
  job: Pick<AuthoringJob, "output">,
  selection: AuthoringProposalSelection | undefined,
  questionId: string,
): AuthoringProposalSelection {
  const current = selection ?? defaultAuthoringProposalSelection(job);
  const questions = job.output?.checkpointSet.questions ?? [];
  const selected = new Set(current.selectedQuestionIds);
  const question = questions.find(({ id }) => id === questionId);
  const pairIds = new Set([questionId]);
  if (question?.linkedRecheckQuestionId) pairIds.add(question.linkedRecheckQuestionId);
  for (const candidate of questions) {
    if (candidate.linkedRecheckQuestionId === questionId) pairIds.add(candidate.id);
  }
  const removePair = [...pairIds].every((id) => selected.has(id));
  for (const id of pairIds) {
    if (removePair) selected.delete(id);
    else selected.add(id);
  }
  return {
    ...current,
    selectedQuestionIds: questions.flatMap(({ id }) => (selected.has(id) ? [id] : [])),
  };
}

export function authoringProposalSelectionCount(selection: AuthoringProposalSelection) {
  return selection.selectedContentSlideIds.length + selection.selectedQuestionIds.length;
}
