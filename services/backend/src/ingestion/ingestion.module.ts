import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attribute } from '../database/entities/attribute.entity';
import { Edge } from '../database/entities/edge.entity';
import { UnresolvedCitation } from '../database/entities/unresolved-citation.entity';
import { Audience } from '../database/entities/audience.entity';
import { AudienceEdge } from '../database/entities/audience-edge.entity';
import { ObligationVersion } from '../database/entities/obligation-version.entity';
import { RuleAssertion } from '../database/entities/rule-assertion.entity';
import { IngestionRun } from '../database/entities/ingestion-run.entity';
import { Obligation } from '../database/entities/obligation.entity';
import { SourceClause } from '../database/entities/source-clause.entity';
import { AiClientService } from './ai-client.service';
import { AttributeResolverService } from './attribute-resolver.service';
import { AssemblyService } from './assembly.service';
import { AudienceResolverService } from './audience-resolver.service';
import { ConsistencyService } from './consistency.service';
import { FilingService } from './filing.service';
import { LinksService } from './links.service';
import { CircularsController } from './circulars.controller';
import { IngestionService } from './ingestion.service';
import { MongoService } from './mongo.service';

@Module({
  imports: [TypeOrmModule.forFeature([
      IngestionRun,
      SourceClause,
      Obligation,
      Attribute,
      Audience,
      AudienceEdge,
      ObligationVersion,
      RuleAssertion,
      Edge,
      UnresolvedCitation,
    ])],
  controllers: [CircularsController],
  providers: [
    IngestionService,
    MongoService,
    AiClientService,
    AttributeResolverService,
    AudienceResolverService,
    FilingService,
    LinksService,
    AssemblyService,
    ConsistencyService,
  ],
  exports: [
    IngestionService,
    MongoService,
    AttributeResolverService,
    AudienceResolverService,
    FilingService,
    LinksService,
    AssemblyService,
    ConsistencyService,
  ],
})
export class IngestionModule {}
