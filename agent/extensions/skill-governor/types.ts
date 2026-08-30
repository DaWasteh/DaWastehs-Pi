import type { Skill } from "@earendil-works/pi-coding-agent";

export type SkillRisk = "low" | "medium" | "high" | "critical";

export interface GovernorConfig {
  schemaVersion: 2;
  enabled: boolean;
  routing: {
    maxSkills: number;
    maxSkillsLocal: number;
    maxLocalSystemPromptBytes: number;
    minScore: number;
  };
  localTools: {
    enabled: boolean;
    interactiveOnly: boolean;
    keep: string[];
    blocked: string[];
  };
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

export interface RankedSkill {
  skill: Skill;
  score: number;
  matchedTerms: string[];
}
