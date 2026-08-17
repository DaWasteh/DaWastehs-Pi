import type { Skill } from "@earendil-works/pi-coding-agent";

export type SkillTier = "auto" | "manual" | "quarantine" | "retired";
export type SkillRisk = "low" | "medium" | "high" | "critical";
export type CandidateStatus = "candidate" | "repaired" | "rejected" | "canary" | "active" | "retired";

export interface SkillPolicyOverride {
  tier?: SkillTier;
  risk?: SkillRisk;
  reason?: string;
}

export interface EvolutionConfig {
  enabled: boolean;
  userApprovedAt?: string;
  minToolCalls: number;
  minToolTypes: number;
  minObservations: number;
  allowCrossProvider: boolean;
  generatorModel?: string;
  criticModel?: string;
  generatorThinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  criticThinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  maxCandidateChars: number;
  maxRepairRounds: number;
}

export interface PromotionConfig {
  automaticCanary: boolean;
  automaticActive: boolean;
  allowedAutomaticRisks: SkillRisk[];
  maxCriticRisk: number;
  minCriticConfidence: number;
  minPairedRuns: number;
  requirePositiveUtility: boolean;
}

export interface GovernorConfig {
  schemaVersion: 1;
  enabled: boolean;
  promptPolicyEnabled: boolean;
  routing: {
    maxAutoSkills: number;
    minScore: number;
  };
  disableDirectSkillManageMutations: boolean;
  protectActiveSkillFiles: boolean;
  evolution: EvolutionConfig;
  promotion: PromotionConfig;
  overrides: Record<string, SkillPolicyOverride>;
}

export interface StaticFinding {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  excerpt?: string;
}

export interface StaticAudit {
  pass: boolean;
  score: number;
  inferredRisk: SkillRisk;
  findings: StaticFinding[];
  sha256: string;
  chars: number;
}

export interface CriticFinding {
  category: string;
  quote: string;
  reason: string;
}

export interface CriticResult {
  decision: "pass" | "repair" | "reject";
  risk: number;
  confidence: number;
  findings: CriticFinding[];
  deleteSpans: string[];
  rationale: string;
  model?: string;
  candidateSha256: string;
}

export interface PairedEvidence {
  taskId: string;
  runId: string;
  evaluator: string;
  candidateSha256: string;
  baselinePassed: boolean;
  candidatePassed: boolean;
  utilityDelta?: number;
  tokenRatio?: number;
  timeRatio?: number;
  hardSafetyViolation?: boolean;
  recordedAt: string;
}

export interface CandidateManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  scope: "global" | "project";
  projectName?: string;
  status: CandidateStatus;
  risk: SkillRisk;
  createdAt: string;
  updatedAt: string;
  source: {
    sessionId?: string;
    taskHash?: string;
    model?: string;
    skillLineage: string[];
    automatic: boolean;
  };
  staticAudit: StaticAudit;
  critic?: CriticResult;
  repairRounds: number;
  evidence: PairedEvidence[];
  promotedPath?: string;
  previousPath?: string;
  notes?: string[];
}

export interface SkillSnapshot {
  skill: Skill;
  tier: SkillTier;
  risk: SkillRisk;
  source: "frontmatter" | "override" | "native";
}

export interface RunObservation {
  userPrompt: string;
  toolCalls: number;
  toolTypes: Set<string>;
  skillReads: Set<string>;
  changedFiles: Set<string>;
  commands: string[];
  toolErrors: number;
  completed: boolean;
  startedAt: number;
}

export interface GeneratedCandidate {
  skip: boolean;
  reason?: string;
  name?: string;
  description?: string;
  scope?: "global" | "project";
  whenToUse?: string;
  procedureSteps?: string[];
  pitfalls?: string[];
  verificationSteps?: string[];
}
