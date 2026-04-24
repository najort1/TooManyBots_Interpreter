import { useCallback } from 'react';
import type { SurveyFilters } from '../types';
import { buildSurveyExportUrl, fetchSurveyExportJson } from '../lib/surveyApi';

function downloadTextFile(content: string, fileName: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function useSurveyExport(filters: SurveyFilters) {
  const exportCsv = useCallback(() => {
    const url = buildSurveyExportUrl(filters, 'csv');
    window.open(url, '_blank');
  }, [filters]);

  const exportJson = useCallback(async () => {
    const rows = await fetchSurveyExportJson(filters);
    downloadTextFile(
      JSON.stringify(rows, null, 2),
      `surveys-export-${Date.now()}.json`,
      'application/json'
    );
  }, [filters]);

  return {
    exportCsv,
    exportJson,
  };
}
