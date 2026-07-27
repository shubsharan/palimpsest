import {
  encodeGitAccountingFrame,
  gitAccountingCharge,
  type GitAccountingFrameV1,
} from "@palimpsest/git-accounting";
import { sha256Hex } from "@palimpsest/contracts";

import { CumulativeLedger } from "./ledger.js";
import { assertAuthorizedRef } from "./policy.js";
import type { AuthenticatedAgent, LedgerEntry } from "./types.js";

export function admitFrame(options: {
  agent: AuthenticatedAgent;
  frame: GitAccountingFrameV1;
  ledger: CumulativeLedger;
  transactionId: string;
}): LedgerEntry {
  assertAuthorizedRef(options.agent, options.frame.refName);
  const bytes = encodeGitAccountingFrame(options.frame);
  return options.ledger.reserve(
    options.transactionId,
    sha256Hex(bytes),
    gitAccountingCharge(options.frame),
  );
}
