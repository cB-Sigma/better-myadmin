import { Tcpdf } from './tcpdf.ts'

export interface PmaPdfOptions {
  /** setAuthor: 'phpMyAdmin ' . Version::VERSION (the tool's name and version) */
  author: string
  /** __('Page number:') */
  pageNumberLabel: string
  /** Util::localisedDate(new DateTimeImmutable()) for the footer */
  date: string
  /** __('Error while creating PDF:') */
  errorLabel?: string
}

/** pma: src/Exceptions/PdfCreationFailure.php */
export class PdfCreationFailure extends Error {}

/**
 * PDF export base class providing basic configuration: DejaVu Sans 14, the author, and a footer
 * with "Page number: n/N" and the date.
 * pma: src/Pdf.php
 */
export class PmaPdf extends Tcpdf {
  readonly footerset = new Set<number>()
  protected readonly opts: PmaPdfOptions

  constructor(orientation: string, unit: 'pt' | 'mm', format: string, opts: PmaPdfOptions) {
    super(orientation, unit, format, opts.author)
    this.opts = opts
    this.setFont('', 14)
  }

  /** getPDFData; Error(): a failure is a PdfCreationFailure "Error while creating PDF: …" */
  override async output(now?: Date): Promise<Uint8Array> {
    try {
      return await super.output(now)
    } catch (e) {
      const label = this.opts.errorLabel ?? 'Error while creating PDF:'
      throw new PdfCreationFailure(`${label} ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  protected override footer(): void {
    // Check if footer for this page already exists
    if (this.footerset.has(this.page)) return
    this.setY(-15)
    this.setFont('', 14)
    this.cell(
      0,
      6,
      `${this.opts.pageNumberLabel} ${this.getAliasNumPage()}/${this.getAliasNbPages()}`,
      'T',
      0,
      'C',
    )
    this.cell(0, 6, this.opts.date, 0, 1, 'R')
    this.setY(20)
    this.footerset.add(this.page)
  }
}
