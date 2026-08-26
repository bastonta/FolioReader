import React from 'react';
import { Annotation, getAnnotationColor } from '../../types/reader';
import { Trash2, Highlighter } from 'lucide-react';
import { useTranslation } from '../../i18n';

interface AnnotationsViewProps {
  annotations: Annotation[];
  onSelectAnnotation: (annotation: Annotation) => void;
  onDeleteAnnotation: (value: string) => void;
}

export const AnnotationsView: React.FC<AnnotationsViewProps> = ({
  annotations,
  onSelectAnnotation,
  onDeleteAnnotation,
}) => {
  const { t } = useTranslation();

  return (
    <div className="annotations-view-container">
      <div className="annotations-list-scroll">
        {annotations.length === 0 ? (
          <div className="sidebar-empty-state">
            <Highlighter size={28} className="empty-state-icon" />
            <p>{t('reader.noAnnotations')}</p>
          </div>
        ) : (
          <div className="annotations-cards-list">
            {annotations.map((ann) => (
              <div
                key={ann.id || ann.value}
                className="annotation-card"
                onClick={() => onSelectAnnotation(ann)}
              >
                <div className="annotation-card-top">
                  <span
                    className="annotation-dot"
                    style={{ backgroundColor: getAnnotationColor(ann.color).hex }}
                  />
                  <p className="annotation-quote-text" title={ann.text}>
                    {ann.text}
                  </p>
                </div>

                {ann.note && <div className="annotation-note-text">{ann.note}</div>}

                <div className="annotation-card-footer">
                  <span className="annotation-time">
                    {ann.createdAt
                      ? new Date(ann.createdAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : ''}
                  </span>
                  <button
                    type="button"
                    className="annotation-delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteAnnotation(ann.value);
                    }}
                    title={t('reader.deleteAnnotation')}
                    aria-label={t('reader.deleteAnnotation')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

