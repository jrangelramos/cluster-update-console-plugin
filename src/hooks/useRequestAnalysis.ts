import * as React from 'react';
import { k8sCreate } from '@openshift-console/dynamic-plugin-sdk';
import { AgenticRunRequestModel } from '../models/agenticrunrequest';
import { getErrorMessage } from '../utils/error';

const CVO_NAMESPACE = 'openshift-cluster-version';

export const useRequestAnalysis = () => {
  const [requesting, setRequesting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const requestAnalysis = React.useCallback(async (targetVersion: string) => {
    setRequesting(true);
    setError(null);
    try {
      await k8sCreate({
        model: AgenticRunRequestModel,
        data: {
          apiVersion: `${AgenticRunRequestModel.apiGroup}/${AgenticRunRequestModel.apiVersion}`,
          kind: AgenticRunRequestModel.kind,
          metadata: {
            generateName: 'request-',
            namespace: CVO_NAMESPACE,
          },
          spec: { targetVersion },
        },
      });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setRequesting(false);
    }
  }, []);

  const clearError = React.useCallback(() => setError(null), []);

  return { requestAnalysis, requesting, error, clearError };
};
