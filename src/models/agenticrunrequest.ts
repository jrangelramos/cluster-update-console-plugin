import {
  K8sModel,
  K8sResourceCommon,
  getGroupVersionKindForModel,
} from '@openshift-console/dynamic-plugin-sdk';

export const AgenticRunRequestModel: K8sModel = {
  apiGroup: 'agentic.openshift.io',
  apiVersion: 'v1alpha1',
  kind: 'AgenticRunRequest',
  plural: 'agenticrunrequests',
  abbr: 'ARR',
  namespaced: true,
  label: 'AgenticRunRequest',
  labelPlural: 'AgenticRunRequests',
};

export const AgenticRunRequestGVK = getGroupVersionKindForModel(AgenticRunRequestModel);

export type AgenticRunRequest = K8sResourceCommon & {
  spec: {
    targetVersion: string;
  };
};
