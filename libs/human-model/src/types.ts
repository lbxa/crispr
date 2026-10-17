import type { AnatomyRegionId } from "./anatomy";
import type { ModelProfile } from "./profiles";

export interface HumanModelHighlight {
  readonly regionId: AnatomyRegionId;
  readonly color?: string;
  readonly strength?: number;
}

export type HumanModelState =
  | { status: "loading"; profile: ModelProfile }
  | { status: "ready"; profile: ModelProfile }
  | { status: "error"; message: string };
