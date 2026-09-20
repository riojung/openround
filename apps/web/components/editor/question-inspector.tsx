import type { ReactNode } from "react";
import styles from "./round-builder.module.css";

export type InspectorTab = "build" | "diagnose" | "recover";

const tabLabels: Record<InspectorTab, string> = {
  build: "Build",
  diagnose: "Diagnose",
  recover: "Recover",
};

export function QuestionInspector({
  activeTab,
  collapsed,
  build,
  diagnose,
  recover,
  onTabChange,
  onToggle,
}: {
  activeTab: InspectorTab;
  collapsed: boolean;
  build: ReactNode;
  diagnose: ReactNode;
  recover: ReactNode;
  onTabChange: (tab: InspectorTab) => void;
  onToggle: () => void;
}) {
  const panels = { build, diagnose, recover };
  return (
    <aside className={styles.inspector} data-collapsed={collapsed} aria-label="Question inspector">
      <div className={styles.inspectorHeader}>
        <div className={styles.inspectorTopline}>
          <h2>Inspector</h2>
          <button className={styles.iconButton} onClick={onToggle} type="button">
            Close
          </button>
        </div>
        <div aria-label="Inspector sections" className={styles.inspectorTabs} role="tablist">
          {(Object.keys(tabLabels) as InspectorTab[]).map((tab) => (
            <button
              aria-controls={`inspector-${tab}`}
              aria-selected={activeTab === tab}
              className={styles.inspectorTab}
              id={`inspector-tab-${tab}`}
              key={tab}
              onClick={() => onTabChange(tab)}
              role="tab"
              type="button"
            >
              {tabLabels[tab]}
            </button>
          ))}
        </div>
      </div>
      {(Object.keys(tabLabels) as InspectorTab[]).map((tab) => (
        <div
          aria-labelledby={`inspector-tab-${tab}`}
          className={styles.inspectorBody}
          hidden={activeTab !== tab}
          id={`inspector-${tab}`}
          key={tab}
          role="tabpanel"
        >
          {panels[tab]}
        </div>
      ))}
    </aside>
  );
}
