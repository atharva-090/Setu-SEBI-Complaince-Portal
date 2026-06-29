export * from './enums';
export * from './source-clause.entity';
export * from './attribute.entity';
export * from './obligation.entity';
export * from './obligation-version.entity';
export * from './edge.entity';
export * from './tenant.entity';
export * from './fact.entity';
export * from './evaluation.entity';
export * from './evidence.entity';
export * from './user.entity';
export * from './audit-log.entity';
export * from './ingestion-run.entity';
export * from './cache.entity';

import { SourceClause } from './source-clause.entity';
import { Attribute } from './attribute.entity';
import { Obligation } from './obligation.entity';
import { ObligationVersion } from './obligation-version.entity';
import { Edge } from './edge.entity';
import { Tenant } from './tenant.entity';
import { Fact } from './fact.entity';
import { Evaluation } from './evaluation.entity';
import { Evidence } from './evidence.entity';
import { User } from './user.entity';
import { AuditLog } from './audit-log.entity';
import { IngestionRun } from './ingestion-run.entity';
import { CacheEntry } from './cache.entity';

export const ALL_ENTITIES = [
  SourceClause,
  Attribute,
  Obligation,
  ObligationVersion,
  Edge,
  Tenant,
  Fact,
  Evaluation,
  Evidence,
  User,
  AuditLog,
  IngestionRun,
  CacheEntry,
];
