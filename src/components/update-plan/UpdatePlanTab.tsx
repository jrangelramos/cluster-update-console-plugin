import * as React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Content,
  EmptyState,
  EmptyStateBody,
  ExpandableSection,
  Flex,
  FlexItem,
  FormSelect,
  FormSelectOption,
  Label,
  Spinner,
  Stack,
  StackItem,
} from '@patternfly/react-core';
import { CubesIcon, RedoIcon, SearchIcon } from '@patternfly/react-icons';
import { k8sPatch } from '@openshift-console/dynamic-plugin-sdk';
import { ClusterVersion } from '../../models/clusterversion';
import { Link } from 'react-router';
import {
  LightspeedAgenticRun,
  LightspeedAgenticRunModel,
  LightspeedAnalysisResult,
  ACTIVE_AGENTIC_RUN_PHASES,
  derivePhase,
  getAnalysisDataFromResult,
  getDecisionDisplay,
  getPhaseDisplay,
} from '../../models/agenticrun';
import { I18N_NAMESPACE, LABELS } from '../../utils/constants';
import { compareSemVer, getUpdateType, unsanitizeVersion } from '../../utils/version';
import { useAnalysisResults } from '../../hooks/useAgenticRuns';
import { useRequestAnalysis } from '../../hooks/useRequestAnalysis';
import PhaseLabel from '../shared/PhaseLabel';
import PlanHeader from './PlanHeader';
import AnalysisResultView from './AnalysisResultView';
// TODO: Re-enable DecisionActions post-TP
// import DecisionActions from './DecisionActions';

type ReanalyseButtonProps = {
  agenticRun: LightspeedAgenticRun;
};

const ReanalyseButton: React.FC<ReanalyseButtonProps> = ({ agenticRun }) => {
  const { t } = useTranslation(I18N_NAMESPACE);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleReanalyse = React.useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      setLoading(true);
      setError(null);
      try {
        const timestamp = new Date().toISOString();
        const hasExisting = !!agenticRun.spec?.revisionFeedback;
        await k8sPatch({
          data: [
            {
              op: hasExisting ? 'replace' : 'add',
              path: '/spec/revisionFeedback',
              value: `Re-analyse requested at ${timestamp}`,
            },
          ],
          model: LightspeedAgenticRunModel,
          resource: agenticRun,
        });
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [agenticRun],
  );

  return (
    <>
      <Button
        variant="link"
        icon={<RedoIcon />}
        isDisabled={loading}
        isLoading={loading}
        onClick={handleReanalyse}
        size="sm"
      >
        {t('Re-analyse')}
      </Button>
      {error && (
        <Alert
          variant="danger"
          isInline
          isPlain
          title={t('Re-analyse failed')}
          style={{ marginTop: '4px' }}
        >
          {error}
        </Alert>
      )}
    </>
  );
};

type UpgradePath = {
  version: string;
  updateType: string;
};

type UpdatePlanTabProps = {
  clusterVersion: ClusterVersion;
  agenticRuns: LightspeedAgenticRun[];
};

const UpdatePlanTab: React.FC<UpdatePlanTabProps> = ({ clusterVersion, agenticRuns }) => {
  const { t } = useTranslation(I18N_NAMESPACE);
  const [selectedVersion, setSelectedVersion] = React.useState('');
  const [expandedPanels, setExpandedPanels] = React.useState<Set<string>>(new Set());
  const userCollapsedRef = React.useRef<Set<string>>(new Set());
  const [requestedVersions, setRequestedVersions] = React.useState<Set<string>>(new Set());
  const [analysisResultsRaw] = useAnalysisResults();
  const analysisResults = analysisResultsRaw ?? [];
  const { requestAnalysis, requesting, error: requestError } = useRequestAnalysis();

  const currentVersion = clusterVersion.status?.desired?.version ?? '';

  // Build upgrade paths from ClusterVersion status
  const upgradePaths: UpgradePath[] = React.useMemo(() => {
    const paths: UpgradePath[] = [];
    for (const u of clusterVersion.status?.availableUpdates ?? []) {
      paths.push({ version: u.version, updateType: getUpdateType(currentVersion, u.version) });
    }
    for (const cu of clusterVersion.status?.conditionalUpdates ?? []) {
      paths.push({
        version: cu.release.version,
        updateType: getUpdateType(currentVersion, cu.release.version),
      });
    }
    return paths.sort((a, b) => compareSemVer(a.version, b.version));
  }, [clusterVersion, currentVersion]);

  // Find matching AgenticRun for a target version
  const findRun = React.useCallback(
    (version: string): LightspeedAgenticRun | undefined =>
      agenticRuns.find(
        (r) => unsanitizeVersion(r.metadata?.labels?.[LABELS.targetVersion] ?? '') === version,
      ),
    [agenticRuns],
  );

  const selectedRun = React.useMemo(() => findRun(selectedVersion), [findRun, selectedVersion]);
  const selectedPhase = derivePhase(selectedRun);

  // Clear requestedVersions once an AgenticRun appears for them
  React.useEffect(() => {
    if (requestedVersions.size === 0) return;
    const stillPending = new Set<string>();
    requestedVersions.forEach((v) => {
      if (!findRun(v)) stillPending.add(v);
    });
    if (stillPending.size < requestedVersions.size) setRequestedVersions(stillPending);
  }, [agenticRuns, requestedVersions, findRun]);

  // Auto-expand when an AgenticRun becomes active
  React.useEffect(() => {
    if (!selectedRun) return;
    const name = selectedRun.metadata?.name;
    const phase = derivePhase(selectedRun);
    if (name && ACTIVE_AGENTIC_RUN_PHASES.has(phase) && !userCollapsedRef.current.has(name)) {
      setExpandedPanels((prev) => new Set(prev).add(name));
    }
  }, [selectedRun]);

  // Handle Analyse click — creates request CR, CVO auto-approves analysis
  const handleAnalyse = React.useCallback(async () => {
    if (!selectedVersion || selectedRun) return;
    await requestAnalysis(selectedVersion);
    setRequestedVersions((prev) => new Set(prev).add(selectedVersion));
  }, [selectedVersion, selectedRun, requestAnalysis]);

  // Auto-select first path
  React.useEffect(() => {
    if (!selectedVersion && upgradePaths.length > 0) {
      setSelectedVersion(upgradePaths[0].version);
    }
  }, [selectedVersion, upgradePaths]);

  const togglePanel = React.useCallback((name: string) => {
    setExpandedPanels((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
        userCollapsedRef.current.add(name);
      } else {
        next.add(name);
        userCollapsedRef.current.delete(name);
      }
      return next;
    });
  }, []);

  if (upgradePaths.length === 0) {
    return (
      <EmptyState titleText={t('No upgrade paths available')} headingLevel="h2" icon={CubesIcon}>
        <EmptyStateBody>
          {t('No available or conditional updates found for this cluster.')}
        </EmptyStateBody>
      </EmptyState>
    );
  }

  const showAnalyseButton = !selectedRun;
  const isRequesting = requestedVersions.has(selectedVersion);

  return (
    <Stack hasGutter>
      {/* Path selector */}
      <StackItem>
        <Card>
          <CardTitle>{t('Select Update Path')}</CardTitle>
          <CardBody>
            <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapMd' }}>
              <FlexItem grow={{ default: 'grow' }} style={{ maxWidth: '400px' }}>
                <FormSelect
                  value={selectedVersion}
                  onChange={(_event, value) => setSelectedVersion(value)}
                  aria-label={t('Select update path')}
                >
                  {upgradePaths.map((path) => {
                    const run = findRun(path.version);
                    const phase = run ? derivePhase(run) : undefined;
                    const phaseSuffix =
                      phase && phase !== 'Pending'
                        ? ` (${getPhaseDisplay(phase).label})`
                        : '';
                    const notAnalysed = !run ? ' — Not analysed' : '';
                    return (
                      <FormSelectOption
                        key={path.version}
                        value={path.version}
                        label={`${path.version} — ${path.updateType}${phaseSuffix}${notAnalysed}`}
                      />
                    );
                  })}
                </FormSelect>
              </FlexItem>
              {selectedRun && (
                <FlexItem>
                  <PhaseLabel phase={selectedPhase} />
                </FlexItem>
              )}
              {showAnalyseButton && !isRequesting && (
                <FlexItem>
                  <Button
                    variant="primary"
                    icon={<SearchIcon />}
                    isDisabled={requesting}
                    isLoading={requesting}
                    onClick={handleAnalyse}
                  >
                    {t('Analyse')}
                  </Button>
                </FlexItem>
              )}
              {isRequesting && !selectedRun && (
                <FlexItem>
                  <Flex
                    alignItems={{ default: 'alignItemsCenter' }}
                    gap={{ default: 'gapSm' }}
                  >
                    <FlexItem>
                      <Spinner size="md" aria-label={t('Requesting')} />
                    </FlexItem>
                    <FlexItem>{t('Requesting analysis...')}</FlexItem>
                  </Flex>
                </FlexItem>
              )}
            </Flex>
            {requestError && (
              <Content
                component="p"
                style={{
                  color: 'var(--pf-t--global--color--status--danger--default)',
                  marginTop: '8px',
                }}
              >
                {requestError}
              </Content>
            )}
          </CardBody>
        </Card>
      </StackItem>

      {/* Selected run's detail panel — only when an AgenticRun exists and is active */}
      {selectedRun &&
        ACTIVE_AGENTIC_RUN_PHASES.has(selectedPhase) &&
        (() => {
          const agenticRun = selectedRun;
          const name = agenticRun.metadata?.name ?? '';
          const rawTarget = agenticRun.metadata?.labels?.[LABELS.targetVersion] ?? '';
          const target = rawTarget ? unsanitizeVersion(rawTarget) : name;
          const pPhase = derivePhase(agenticRun);
          const phaseDisplay = getPhaseDisplay(pPhase);

          const stepResults = agenticRun.status?.steps?.analysis?.results;
          const resultRef = (stepResults?.[stepResults.length - 1] as { name?: string })?.name;
          const result = resultRef
            ? analysisResults.find(
                (r: LightspeedAnalysisResult) =>
                  r.metadata?.name === resultRef &&
                  r.metadata?.namespace === agenticRun.metadata?.namespace,
              )
            : undefined;
          const resultData = getAnalysisDataFromResult(result);
          const readinessSummary = resultData.components.find(
            (c) => c.type === 'ota_readiness_summary',
          );
          const decision =
            ((readinessSummary as Record<string, unknown>)?.decision as string | undefined) ??
            (resultData.analysisData?.decision as string | undefined);
          const decisionDisplay = decision ? getDecisionDisplay(decision) : undefined;

          return (
            <StackItem key={name}>
              <ExpandableSection
                toggleContent={
                  <Flex
                    alignItems={{ default: 'alignItemsCenter' }}
                    gap={{ default: 'gapSm' }}
                  >
                    <FlexItem>
                      <strong>{t('Update to {{version}}', { version: target })}</strong>
                    </FlexItem>
                    <FlexItem>
                      <Label color={phaseDisplay.color} isCompact>
                        {phaseDisplay.label}
                      </Label>
                    </FlexItem>
                    {decisionDisplay && pPhase !== 'Analyzing' && (
                      <FlexItem>
                        <Label color={decisionDisplay.color} isCompact>
                          {decisionDisplay.label}
                        </Label>
                      </FlexItem>
                    )}
                    <FlexItem>
                      <ReanalyseButton agenticRun={agenticRun} />
                    </FlexItem>
                  </Flex>
                }
                isExpanded={expandedPanels.has(name)}
                onToggle={() => togglePanel(name)}
                isIndented
              >
                <Stack hasGutter>
                  <StackItem>
                    <PlanHeader agenticRun={agenticRun} />
                  </StackItem>
                  {pPhase === 'Analyzing' ? (
                    <StackItem>
                      <Card>
                        <CardBody>
                          <Flex
                            alignItems={{ default: 'alignItemsCenter' }}
                            gap={{ default: 'gapMd' }}
                          >
                            <FlexItem>
                              <Spinner size="lg" aria-label={t('Analyzing')} />
                            </FlexItem>
                            <FlexItem>
                              <Stack>
                                <StackItem>
                                  <strong>
                                    {agenticRun.status?.steps?.analysis?.sandbox?.claimName
                                      ? t('AI agent is analysing cluster readiness...')
                                      : t('Starting analysis — waiting for agent sandbox...')}
                                  </strong>
                                </StackItem>
                                {agenticRun.status?.steps?.analysis?.sandbox?.claimName && (
                                  <StackItem>
                                    <Content component="small">
                                      {t('Sandbox: {{name}}', {
                                        name: agenticRun.status.steps.analysis.sandbox.claimName,
                                      })}
                                      {' — '}
                                      <Link
                                        to={`/k8s/ns/${agenticRun.status.steps.analysis.sandbox.namespace ?? 'openshift-lightspeed'}/pods/${agenticRun.status.steps.analysis.sandbox.claimName}/logs`}
                                      >
                                        {t('View pod logs')}
                                      </Link>
                                    </Content>
                                  </StackItem>
                                )}
                              </Stack>
                            </FlexItem>
                          </Flex>
                        </CardBody>
                      </Card>
                    </StackItem>
                  ) : pPhase === 'Failed' ? (
                    <StackItem>
                      <Alert variant="danger" isInline title={t('Analysis failed')}>
                        {(
                          agenticRun.status?.conditions as { type: string; message: string }[]
                        )?.find((c) => c.type === 'Analyzed')?.message ?? t('Unknown error')}
                      </Alert>
                    </StackItem>
                  ) : (
                    <StackItem>
                      {resultData.components.length > 0 || resultData.analysisData ? (
                        <AnalysisResultView analysisData={resultData} />
                      ) : (
                        <Content component="p">
                          {t('Analysis result not yet available.')}
                        </Content>
                      )}
                    </StackItem>
                  )}
                </Stack>
              </ExpandableSection>
            </StackItem>
          );
        })()}
    </Stack>
  );
};

export default UpdatePlanTab;
