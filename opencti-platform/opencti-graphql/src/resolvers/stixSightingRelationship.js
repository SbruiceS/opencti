import * as R from 'ramda';
import { withFilter } from 'graphql-subscriptions';
import { BUS_TOPICS } from '../config/conf';
import {
  addStixSightingRelationship,
  findAll,
  findById,
  stixSightingRelationshipAddRelation,
  stixSightingRelationshipCleanContext,
  stixSightingRelationshipDelete,
  stixSightingRelationshipDeleteRelation,
  stixSightingRelationshipEditContext,
  stixSightingRelationshipEditField,
  stixSightingRelationshipsNumber,
  batchCreatedBy,
  batchExternalReferences,
  batchLabels,
  batchMarkingDefinitions,
  batchNotes,
  batchOpinions,
  batchReports,
} from '../domain/stixSightingRelationship';
import { fetchEditContext, pubsub } from '../database/redis';
import withCancel from '../graphql/subscriptionWrapper';
import { distributionRelations, timeSeriesRelations, batchLoader, stixLoadByIdStringify } from '../database/middleware';
import { RELATION_CREATED_BY, RELATION_OBJECT_LABEL, RELATION_OBJECT_MARKING } from '../schema/stixMetaRelationship';
import { STIX_SIGHTING_RELATIONSHIP } from '../schema/stixSightingRelationship';
import { creator } from '../domain/log';
import { buildRefRelationKey } from '../schema/general';
import { elBatchIds } from '../database/engine';
import { findById as findStatusById, getTypeStatuses } from '../domain/status';

const createdByLoader = batchLoader(batchCreatedBy);
const markingDefinitionsLoader = batchLoader(batchMarkingDefinitions);
const labelsLoader = batchLoader(batchLabels);
const externalReferencesLoader = batchLoader(batchExternalReferences);
const notesLoader = batchLoader(batchNotes);
const opinionsLoader = batchLoader(batchOpinions);
const reportsLoader = batchLoader(batchReports);

const loadByIdLoader = batchLoader(elBatchIds);

const stixSightingRelationshipResolvers = {
  Query: {
    stixSightingRelationship: (_, { id }, context) => findById(context, context.user, id),
    stixSightingRelationships: (_, args, context) => findAll(context, context.user, args),
    stixSightingRelationshipsTimeSeries: (_, args, context) => timeSeriesRelations(context, context.user, args),
    stixSightingRelationshipsDistribution: (_, args, context) => distributionRelations(
      context,
      context.user,
      R.pipe(R.assoc('relationship_type', 'stix-sighting-relationship'), R.assoc('isTo', true))(args)
    ),
    stixSightingRelationshipsNumber: (_, args, context) => stixSightingRelationshipsNumber(context, context.user, args),
  },
  StixSightingRelationshipsFilter: {
    createdBy: buildRefRelationKey(RELATION_CREATED_BY),
    markedBy: buildRefRelationKey(RELATION_OBJECT_MARKING),
    labelledBy: buildRefRelationKey(RELATION_OBJECT_LABEL),
  },
  StixSightingRelationship: {
    relationship_type: () => 'stix-sighting-relationship',
    from: (rel, _, context) => loadByIdLoader.load(rel.fromId, context, context.user),
    to: (rel, _, context) => loadByIdLoader.load(rel.toId, context, context.user),
    toStix: (rel, _, context) => stixLoadByIdStringify(context, context.user, rel.id),
    creator: (rel, _, context) => creator(context, context.user, rel.id, STIX_SIGHTING_RELATIONSHIP),
    createdBy: (rel, _, context) => createdByLoader.load(rel.id, context, context.user),
    objectMarking: (rel, _, context) => markingDefinitionsLoader.load(rel.id, context, context.user),
    objectLabel: (rel, _, context) => labelsLoader.load(rel.id, context, context.user),
    externalReferences: (rel, _, context) => externalReferencesLoader.load(rel.id, context, context.user),
    reports: (rel, _, context) => reportsLoader.load(rel.id, context, context.user),
    notes: (rel, _, context) => notesLoader.load(rel.id, context, context.user),
    opinions: (rel, _, context) => opinionsLoader.load(rel.id, context, context.user),
    editContext: (rel) => fetchEditContext(rel.id),
    status: (entity, _, context) => (entity.x_opencti_workflow_id ? findStatusById(context, context.user, entity.x_opencti_workflow_id) : null),
    workflowEnabled: async (entity, _, context) => {
      const statusesEdges = await getTypeStatuses(context, context.user, entity.entity_type);
      return statusesEdges.edges.length > 0;
    },
  },
  Mutation: {
    stixSightingRelationshipEdit: (_, { id }, context) => ({
      delete: () => stixSightingRelationshipDelete(context, context.user, id),
      fieldPatch: ({ input }) => stixSightingRelationshipEditField(context, context.user, id, input),
      contextPatch: ({ input }) => stixSightingRelationshipEditContext(context, context.user, id, input),
      contextClean: () => stixSightingRelationshipCleanContext(context, context.user, id),
      relationAdd: ({ input }) => stixSightingRelationshipAddRelation(context, context.user, id, input),
      relationDelete: ({ toId, relationship_type: relationshipType }) => stixSightingRelationshipDeleteRelation(context, context.user, id, toId, relationshipType),
    }),
    stixSightingRelationshipAdd: (_, { input }, context) => addStixSightingRelationship(context, context.user, input),
  },
  Subscription: {
    stixSightingRelationship: {
      resolve: /* istanbul ignore next */ (payload) => payload.instance,
      subscribe: /* istanbul ignore next */ (_, { id }, context) => {
        stixSightingRelationshipEditContext(context, context.user, id);
        const filtering = withFilter(
          () => pubsub.asyncIterator(BUS_TOPICS[STIX_SIGHTING_RELATIONSHIP].EDIT_TOPIC),
          (payload) => {
            if (!payload) return false; // When disconnect, an empty payload is dispatched.
            return payload.user.id !== context.user.id && payload.instance.id === id;
          }
        )(_, { id }, context);
        return withCancel(filtering, () => {
          stixSightingRelationshipCleanContext(context, context.user, id);
        });
      },
    },
  },
};

export default stixSightingRelationshipResolvers;
