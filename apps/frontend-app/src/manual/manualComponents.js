import React from "react";
import { Link } from "react-router-dom";

export function ManualDataTable({ table }) {
  if (!table?.rows?.length) return null;
  return (
    <div className="manual-data-card">
      <div className="manual-card-title-row">
        <h4>{table.title}</h4>
      </div>
      <div className="manual-table-wrap">
        <table className="manual-table">
          <thead>
            <tr>
              {table.columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={`${table.title}-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`${table.title}-${rowIndex}-${cellIndex}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ManualPreviewCard({ preview }) {
  if (!preview) return null;
  const disabled = !preview.route;
  return (
    <article className="manual-preview-card">
      <div className="manual-card-title-row">
        <h4>{preview.title}</h4>
        <span className="manual-chip manual-chip-muted">Screen reference</span>
      </div>
      <p>{preview.description}</p>
      {preview.screenshot ? (
        <div className="manual-screen-reference">
          <img src={preview.screenshot} alt={preview.title} className="manual-screen-image" />
        </div>
      ) : null}
      <div className="manual-preview-actions">
        {disabled ? (
          <span className="manual-inline-note">{preview.unavailableReason || "This screen is not available yet."}</span>
        ) : (
          <Link className="manual-inline-link" to={preview.route}>
            Open full page
          </Link>
        )}
        {!disabled && <code>{preview.route}</code>}
      </div>
    </article>
  );
}

export function ManualSection({ section }) {
  return (
    <section className="manual-section" id={section.id}>
      <div className="manual-section-header">
        <div className="manual-section-icon">{section.icon}</div>
        <div className="manual-section-heading">
          <div className="manual-chip-row">
            <span className="manual-chip">{section.category}</span>
            <span className="manual-chip manual-chip-muted">{section.audience}</span>
          </div>
          <h3>{section.title}</h3>
          <p>{section.summary}</p>
        </div>
      </div>

      {section.facts?.length ? (
        <div className="manual-facts-grid">
          {section.facts.map((fact) => (
            <article key={`${section.id}-${fact.label}`} className="manual-fact-card">
              <span className="manual-fact-label">{fact.label}</span>
              <strong>{fact.value}</strong>
            </article>
          ))}
        </div>
      ) : null}

      {section.journeys?.length ? (
        <div className="manual-journey-grid">
          {section.journeys.map((journey) => (
            <article key={`${section.id}-${journey.title}`} className="manual-journey-card">
              <div className="manual-card-title-row">
                <h4>{journey.title}</h4>
              </div>
              <ul className="manual-list">
                {journey.items.map((item) => (
                  <li key={`${section.id}-${journey.title}-${item}`}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      ) : null}

      <ManualDataTable table={section.table} />

      {section.tables?.length ? (
        <div className="manual-data-stack">
          {section.tables.map((table) => (
            <ManualDataTable key={`${section.id}-${table.title}`} table={table} />
          ))}
        </div>
      ) : null}

      {section.previews?.length ? (
        <div className="manual-preview-grid">
          {section.previews.map((preview) => (
            <ManualPreviewCard key={preview.id} preview={preview} />
          ))}
        </div>
      ) : null}

      {section.links?.length ? (
        <div className="manual-links-card">
          <div className="manual-card-title-row">
            <h4>Jump to the real page</h4>
          </div>
          <div className="manual-link-grid">
            {section.links.map((link) => (
              <Link key={`${section.id}-${link.label}`} className="manual-link-card" to={link.route}>
                <strong>{link.label}</strong>
                <span>{link.description}</span>
                <code>{link.route}</code>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {section.tableCatalogs?.length ? (
        <div className="manual-catalog-stack">
          {section.tableCatalogs.map((catalog) => (
            <div key={`${section.id}-${catalog.title}`} className="manual-data-card">
              <div className="manual-card-title-row">
                <h4>{catalog.title}</h4>
              </div>
              <p>{catalog.description}</p>
              <div className="manual-catalog-grid">
                {catalog.tables.map((tableEntry) => (
                  <article key={`${catalog.title}-${tableEntry.name}`} className="manual-catalog-card">
                    <strong>{tableEntry.name}</strong>
                    <p>{tableEntry.purpose}</p>
                    <div className="manual-tag-list">
                      {tableEntry.columns.map((column) => (
                        <span key={`${tableEntry.name}-${column}`} className="manual-tag">
                          {column}
                        </span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {section.endpointFamilies?.length ? (
        <div className="manual-endpoint-grid">
          {section.endpointFamilies.map((family) => (
            <article key={`${section.id}-${family.name}`} className="manual-endpoint-card">
              <div className="manual-card-title-row">
                <h4>{family.name}</h4>
                <code>{family.route}</code>
              </div>
              <ul className="manual-list">
                {family.details.map((detail) => (
                  <li key={`${family.name}-${detail}`}>{detail}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      ) : null}

      {section.flowCards?.length ? (
        <div className="manual-flow-grid">
          {section.flowCards.map((flow) => (
            <article key={`${section.id}-${flow.title}`} className="manual-flow-card">
              <div className="manual-card-title-row">
                <h4>{flow.title}</h4>
              </div>
              <ol className="manual-ordered-list">
                {flow.steps.map((step) => (
                  <li key={`${flow.title}-${step}`}>{step}</li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      ) : null}

      {section.tips?.length ? (
        <div className="manual-callout manual-callout-info">
          <strong>Practical tips</strong>
          <ul className="manual-list">
            {section.tips.map((tip) => (
              <li key={`${section.id}-${tip}`}>{tip}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {section.warnings?.length ? (
        <div className="manual-callout manual-callout-warning">
          <strong>Watch-outs</strong>
          <ul className="manual-list">
            {section.warnings.map((warning) => (
              <li key={`${section.id}-${warning}`}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
