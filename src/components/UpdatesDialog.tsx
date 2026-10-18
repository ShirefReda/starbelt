import { useEffect, useState } from "preact/hooks";
import { APP_VERSIONS, CURRENT_VERSION } from "../config/version";
import type { AppVersion, ChangeCategory } from "../config/version";
import { S } from "../i18n/strings";
import { IconBug, IconClose, IconSparkle } from "./icons";

interface UpdatesDialogProps {
  onClose: () => void;
  isFirstVisitAfterUpdate?: boolean;
}

export function UpdatesDialog({ onClose, isFirstVisitAfterUpdate = false }: UpdatesDialogProps) {
  const [showHistory, setShowHistory] = useState(false);
  const latest = APP_VERSIONS[0];
  const previousVersions = APP_VERSIONS.slice(1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const renderBadge = (cat: ChangeCategory) => {
    switch (cat) {
      case "bug":
        return (
          <span class="change-pill change-pill--bug">
            <IconBug />
            <span>{S.updates.categories.bug}</span>
          </span>
        );
      case "feat":
        return (
          <span class="change-pill change-pill--feat">
            <IconSparkle />
            <span>{S.updates.categories.feat}</span>
          </span>
        );
      case "improvement":
      default:
        return (
          <span class="change-pill change-pill--improvement">
            <span>{S.updates.categories.improvement}</span>
          </span>
        );
    }
  };

  const renderVersionCard = (v: AppVersion, isPrimary = false) => (
    <div key={v.version} class={`version-card${isPrimary ? " version-card--primary" : ""}`}>
      <div class="version-card__head">
        <div class="version-card__title-row">
          <span class="version-tag">
            <span class="version-tag__label">{S.updates.versionPrefix}</span>
            <span class="version-tag__num">{v.version}</span>
          </span>
          {isPrimary && isFirstVisitAfterUpdate && (
            <span class="version-new-badge">{S.updates.newBadge}</span>
          )}
          <span class="version-card__date">{v.date}</span>
        </div>
        <h3 class="version-card__title">{v.title}</h3>
        {v.summary && <p class="version-card__summary">{v.summary}</p>}
      </div>

      <ul class="version-card__changes" role="list">
        {v.changes.map((item, idx) => (
          <li key={idx} class={`version-change-item version-change-item--${item.category}`}>
            <div class="version-change-item__badge">{renderBadge(item.category)}</div>
            <div class="version-change-item__content">
              <span class="version-change-item__text">{item.text}</span>
              {item.details && (
                <span class="version-change-item__details">{item.details}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div
      class="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="updates-dialog-title"
      onClick={onClose}
    >
      <div
        class="dialog dialog--updates"
        onClick={(e) => e.stopPropagation()}
        role="document"
      >
        <div class="dialog__head">
          <div class="dialog__icon-title">
            <span class="dialog-badge-icon" aria-hidden="true">
              <IconSparkle />
            </span>
            <div>
              <h2 id="updates-dialog-title" class="dialog__title">
                {S.updates.dialogTitle}
              </h2>
              <span class="dialog__subtitle">
                نظام ستار بيلت — الإصدار الحالي {CURRENT_VERSION}
              </span>
            </div>
          </div>
          <button
            type="button"
            class="dialog__close"
            onClick={onClose}
            aria-label="إغلاق النافذة"
          >
            <IconClose />
          </button>
        </div>

        <div class="dialog__body updates-dialog__body">
          {isFirstVisitAfterUpdate && (
            <div class="updates-alert-banner">
              <span class="updates-alert-banner__icon">✨</span>
              <span>{S.updates.autoAlertMessage}</span>
            </div>
          )}

          {/* Current / Latest Version */}
          {renderVersionCard(latest, true)}

          {/* Previous releases history toggle */}
          {previousVersions.length > 0 && (
            <div class="version-history-section">
              <button
                type="button"
                class="btn-toggle-history"
                onClick={() => setShowHistory((s) => !s)}
                aria-expanded={showHistory}
              >
                <span>{showHistory ? S.updates.hideHistory : S.updates.viewHistory}</span>
                <span class="history-count">({previousVersions.length})</span>
                <span class="toggle-arrow">{showHistory ? "▲" : "▼"}</span>
              </button>

              {showHistory && (
                <div class="previous-versions-list">
                  {previousVersions.map((v) => renderVersionCard(v, false))}
                </div>
              )}
            </div>
          )}
        </div>

        <div class="dialog__foot updates-dialog__foot">
          <div class="updates-dialog__foot-hint">
            يتم تطبيق التحديثات التلقائية فوراً للحفاظ على استقرار النظام ودقة الأسعار.
          </div>
          <button type="button" class="btn btn--gold btn--primary-action" onClick={onClose}>
            {S.updates.dismiss}
          </button>
        </div>
      </div>
    </div>
  );
}
