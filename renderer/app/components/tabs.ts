import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { MoveTab, SelectTab, Tab } from '../state/layout';

import { RootPageComponent } from '../pages/root/page';
import { Store } from '@ngxs/store';
import { View } from '../state/views';

/**
 * Tabs component
 */

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'elfile-tabs',
  templateUrl: 'tabs.html',
  styleUrls: ['tabs.scss']
})

export class TabsComponent {

  @Input() splitID: string;
  @Input() tabs = [] as Tab[];
  @Input() tabIndex: number;
  @Input() view = { } as View;

  /** ctor */
  constructor(private root: RootPageComponent,
              private store: Store) {  }

  // event handlers

  onEditTab(event: MouseEvent,
            tab: Tab): void {
    this.root.onEditTab(tab, (this.tabs.length === 1));
    event.stopPropagation();
  }

  onEditView(): void {
    this.root.onEditView(this.view, this.tabs[this.tabIndex].id);
  }

  onMoveTab(tab: Tab,
            ix: number): void {
    this.store.dispatch(new MoveTab({ splitID: this.splitID, tab, ix }));
  }

  onTabSelect(ix: number): void {
    this.store.dispatch(new SelectTab({ tab: this.tabs[ix] }));
  }

}
