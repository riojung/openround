/** Both editor APIs must accept the same bounded Round drafts. */
export const ROUND_DRAFT_BODY_LIMIT = 4_000_000;

/** Leave space for subsequent edits and the revision/mutation request envelope. */
export const ROUND_PACK_INSERTION_DRAFT_LIMIT = 3_500_000;

/** Covers all bounded Pack fields, including multi-byte text and citation excerpts. */
export const RECOVERY_PACK_BODY_LIMIT = 1_000_000;
