import { useEffect, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { HeaderInputList } from '@/components/ui/HeaderInputList';
import { Input } from '@/components/ui/Input';
import { ModelInputList } from '@/components/ui/ModelInputList';
import { buildCandidateUsageSourceIds, lookupStatusBar } from '@/utils/usage';
import type { ProviderGroupFormState, ProviderKind } from './types';
import { ProviderConnectivityPanel } from './ProviderConnectivityPanel';
import { ProviderKeyEntriesEditor } from './ProviderKeyEntriesEditor';
import { useProviderStats } from './hooks/useProviderStats';
import styles from '@/pages/AiProvidersPage.module.scss';

type ProviderGroupEditFormProps = {
  provider: ProviderKind;
  form: ProviderGroupFormState;
  setForm: (updater: (prev: ProviderGroupFormState) => ProviderGroupFormState) => void;
  disabled?: boolean;
  testing?: boolean;
  summaryStatus: 'idle' | 'loading' | 'success' | 'error';
  summaryMessage: string;
  onTestAll: () => Promise<void> | void;
  onTestOne?: (index: number) => Promise<void> | void;
  onOpenModelDiscovery?: () => void;
  streamEnabled?: boolean;
  onToggleStreamEnabled?: (value: boolean) => void;
  testAllLabelKey?: string;
  testAllLabelDefault?: string;
  keyEditorShowStatusColumn?: boolean;
  keyEditorShowProxyColumn?: boolean;
  keyEntryHighlightIndexes?: number[];
  singleEntryMode?: boolean;
  renderExtraFields?: ReactNode;
  renderBeforeKeyEntries?: ReactNode;
  renderAfterModels?: ReactNode;
  showNameField?: boolean;
};

export function ProviderGroupEditForm({
  provider,
  form,
  setForm,
  disabled = false,
  testing = false,
  summaryStatus,
  summaryMessage,
  onTestAll,
  onTestOne,
  onOpenModelDiscovery,
  streamEnabled = true,
  onToggleStreamEnabled,
  testAllLabelKey,
  testAllLabelDefault,
  keyEditorShowStatusColumn = true,
  keyEditorShowProxyColumn = true,
  keyEntryHighlightIndexes = [],
  singleEntryMode = false,
  renderExtraFields,
  renderBeforeKeyEntries,
  renderAfterModels,
  showNameField = false,
}: ProviderGroupEditFormProps) {
  const { t } = useTranslation();
  const providerKey = provider === 'openai' ? 'openai' : provider;
  const { statusBarBySource, loadKeyStats } = useProviderStats();

  useEffect(() => {
    void loadKeyStats();
  }, [loadKeyStats]);

  const keyEntryStatusBars = useMemo(
    () =>
      form.keyEntries.map((entry) =>
        lookupStatusBar(
          statusBarBySource,
          entry.authIndex && statusBarBySource.has(entry.authIndex)
            ? [entry.authIndex]
            : buildCandidateUsageSourceIds({
                apiKey: entry.apiKey,
                prefix: form.prefix,
              })
        )
      ),
    [form.keyEntries, form.prefix, statusBarBySource]
  );

  return (
    <div className={styles.openaiEditForm}>
      {showNameField ? (
        <Input
          label={t('ai_providers.openai_add_modal_name_label')}
          value={form.name ?? ''}
          onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          disabled={disabled || testing}
        />
      ) : null}
      <Input
        label={t('ai_providers.priority_label')}
        hint={t('ai_providers.priority_hint')}
        type="number"
        step={1}
        value={form.priority ?? ''}
        onChange={(event) => {
          const raw = event.target.value;
          const parsed = raw.trim() === '' ? undefined : Number(raw);
          setForm((prev) => ({
            ...prev,
            priority: parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
          }));
        }}
        disabled={disabled || testing}
      />
      <Input
        label={t('ai_providers.prefix_label')}
        placeholder={t('ai_providers.prefix_placeholder')}
        value={form.prefix}
        onChange={(event) => setForm((prev) => ({ ...prev, prefix: event.target.value }))}
        hint={t('ai_providers.prefix_hint')}
        disabled={disabled || testing}
      />
      <Input
        label={t(`ai_providers.${providerKey}_add_modal_url_label`, {
          defaultValue: t('common.base_url'),
        })}
        placeholder={t(`ai_providers.${providerKey}_base_url_placeholder`, {
          defaultValue: t('common.base_url'),
        })}
        value={form.baseUrl}
        onChange={(event) => setForm((prev) => ({ ...prev, baseUrl: event.target.value }))}
        disabled={disabled || testing}
      />

      {renderExtraFields}

      <HeaderInputList
        entries={form.headers}
        onChange={(entries) => setForm((prev) => ({ ...prev, headers: entries }))}
        addLabel={t('common.custom_headers_add')}
        keyPlaceholder={t('common.custom_headers_key_placeholder')}
        valuePlaceholder={t('common.custom_headers_value_placeholder')}
        removeButtonTitle={t('common.delete')}
        removeButtonAriaLabel={t('common.delete')}
        disabled={disabled || testing}
      />

      <div className={styles.modelConfigSection}>
        <div className={styles.modelConfigHeader}>
          <label className={styles.modelConfigTitle}>
            {t(`ai_providers.${providerKey}_models_label`, { defaultValue: t('common.model') })}
          </label>
          <div className={styles.modelConfigToolbar}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setForm((prev) => ({
                  ...prev,
                  modelEntries: [...prev.modelEntries, { name: '', alias: '' }],
                }))
              }
              disabled={disabled || testing}
            >
              {t(`ai_providers.${providerKey}_models_add_btn`, { defaultValue: '添加模型' })}
            </Button>
            {onOpenModelDiscovery ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={onOpenModelDiscovery}
                disabled={disabled || testing}
              >
                {t(`ai_providers.${providerKey}_models_fetch_button`, { defaultValue: '发现模型' })}
              </Button>
            ) : null}
          </div>
        </div>
        <div className={styles.sectionHint}>
          {t(`ai_providers.${providerKey}_models_hint`, { defaultValue: '' })}
        </div>
        <ModelInputList
          entries={form.modelEntries}
          onChange={(entries) => setForm((prev) => ({ ...prev, modelEntries: entries }))}
          namePlaceholder={t('common.model_name_placeholder')}
          aliasPlaceholder={t('common.model_alias_placeholder')}
          aliasFirst
          disabled={disabled || testing}
          hideAddButton
          className={styles.modelInputList}
          rowClassName={styles.modelInputRow}
          inputClassName={styles.modelInputField}
          removeButtonClassName={styles.modelRowRemoveButton}
          removeButtonTitle={t('common.delete')}
          removeButtonAriaLabel={t('common.delete')}
        />
      </div>

      <div className={styles.modelTestSection}>
        <ProviderConnectivityPanel
          provider={provider}
          modelEntries={form.modelEntries}
          testModel={form.testModel}
          disabled={disabled}
          testing={testing}
          entries={form.keyEntries}
          globalHeaders={form.headers}
          summaryStatus={summaryStatus}
          summaryMessage={summaryMessage}
          titleKey={`ai_providers.${providerKey}_test_title`}
          hintKey={`ai_providers.${providerKey}_test_hint`}
          testAllLabelKey={testAllLabelKey}
          testAllLabelDefault={testAllLabelDefault}
          streamEnabled={streamEnabled}
          onToggleStreamEnabled={onToggleStreamEnabled}
          onChangeTestModel={(value) => setForm((prev) => ({ ...prev, testModel: value }))}
          onTestAll={onTestAll}
        />
      </div>

      <div className={styles.keyEntriesSection}>
        <div className={styles.keyEntriesHeader}>
          <label className={styles.keyEntriesTitle}>
            {t(`ai_providers.${providerKey}_add_modal_keys_label`, {
              defaultValue: t(`ai_providers.${providerKey}_add_modal_key_label`, {
                defaultValue: '密钥',
              }),
            })}
          </label>
          <span className={styles.keyEntriesHint}>
            {t('ai_providers.openai_keys_hint', {
              defaultValue: '回车自动新增一行，支持一次粘贴多行密钥。',
            })}
          </span>
        </div>
        {renderBeforeKeyEntries}
        <ProviderKeyEntriesEditor
          provider={provider}
          entries={form.keyEntries}
          disabled={disabled}
          testing={testing}
          hasConfiguredModels={form.modelEntries.some((entry) => entry.name.trim())}
          globalHeaders={form.headers}
          showStatusColumn={keyEditorShowStatusColumn}
          showProxyColumn={keyEditorShowProxyColumn}
          showEnabledToggle
          highlightIndexes={keyEntryHighlightIndexes}
          statusBarDataByEntry={keyEntryStatusBars}
          singleEntryMode={singleEntryMode}
          onChange={(entries) => setForm((prev) => ({ ...prev, keyEntries: entries }))}
          onTestOne={onTestOne}
        />
      </div>

      <div className="form-group">
        <label>{t('ai_providers.excluded_models_label')}</label>
        <textarea
          className="input"
          placeholder={t('ai_providers.excluded_models_placeholder')}
          value={form.excludedText}
          onChange={(event) => setForm((prev) => ({ ...prev, excludedText: event.target.value }))}
          rows={4}
          disabled={disabled || testing}
        />
        <div className="hint">{t('ai_providers.excluded_models_hint')}</div>
      </div>

      {renderAfterModels}
    </div>
  );
}
