import { AfterViewInit, Directive, ElementRef, OnDestroy, inject } from '@angular/core';

/**
 * `<table class="table stack">`: copies each column's header text into its cells as `data-label`,
 * so on phones (see styles.scss) every row renders as a labelled card instead of a wide table.
 * Cells that already have a data-label keep it; rows added later are labelled too.
 */
@Directive({ selector: 'table.stack' })
export class StackTableDirective implements AfterViewInit, OnDestroy {
  private el = inject<ElementRef<HTMLTableElement>>(ElementRef);
  private observer?: MutationObserver;

  ngAfterViewInit() {
    this.label();
    this.observer = new MutationObserver(() => this.label());
    this.observer.observe(this.el.nativeElement, { childList: true, subtree: true, characterData: true });
  }

  ngOnDestroy() {
    this.observer?.disconnect();
  }

  private label() {
    const table = this.el.nativeElement;
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '');
    for (const row of table.querySelectorAll('tbody tr')) {
      [...row.children].forEach((cell, i) => {
        const h = heads[i];
        if (h && !cell.hasAttribute('data-label') && !cell.hasAttribute('colspan')) cell.setAttribute('data-label', h);
      });
    }
  }
}
