/**
 * The one entry point the app reaches for, and the boundary of the lazy chunk.
 *
 * Everything under `src/lib/pdf` is only ever loaded through a dynamic import
 * of this file, which keeps pdf-lib out of the bundle an inspector downloads to
 * open a checklist. It is still precached with the rest of the build, so the
 * first tap works with no signal.
 */
import { downloadFile } from '../exportCsv';
import type { Annotation } from '../annotate';
import type { Customer, Inspection } from '../types';
import { buildReportDocument, type ChecklistLike } from './content';
import { generateReportPdf } from './render';

export async function downloadReportPdf(input: {
  inspection: Inspection;
  checklist: ChecklistLike;
  customer?: Customer;
  companyName: string;
  logo?: string;
  getPhoto: (id: string) => Promise<{ blob?: Blob; annotations?: Annotation[] } | undefined>;
}): Promise<void> {
  const document = buildReportDocument(input);
  const blob = await generateReportPdf({ document, getPhoto: input.getPhoto });
  downloadFile(`${document.slug}.pdf`, blob);
}
