import type { EffectiveConfigurationOutline as EffectiveConfigurationOutlineView } from "@/modules/effective-configuration";

export function EffectiveConfigurationOutline({
  outline,
}: {
  readonly outline: EffectiveConfigurationOutlineView;
}) {
  const titleId = "effective-configuration-title";
  return (
    <section aria-labelledby={titleId}>
      <h2 id={titleId}>{outline.title}</h2>

      <h3>Effective instruction order</h3>
      {outline.instructionOrder.length > 0 ? (
        <ol>
          {outline.instructionOrder.map((instruction) => (
            <li key={instruction.nodeId}>
              {instruction.label} <span>({instruction.source})</span>
            </li>
          ))}
        </ol>
      ) : (
        <p>No effective instructions were detected.</p>
      )}

      <table>
        <caption>Components and source provenance</caption>
        <thead>
          <tr>
            <th scope="col">Component</th>
            <th scope="col">Kind</th>
            <th scope="col">Status</th>
            <th scope="col">Source</th>
            <th scope="col">Adapter rule</th>
            <th scope="col">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {outline.rows.map((row) => (
            <tr key={row.nodeId}>
              <th scope="row">{row.component}</th>
              <td>{row.kind}</td>
              <td>{row.status}</td>
              <td>{row.source}</td>
              <td>{row.adapterRule}</td>
              <td>{row.confidence}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Relationships</h3>
      {outline.relationships.length > 0 ? (
        <table>
          <caption>Source-backed component relationships</caption>
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Relationship</th>
              <th scope="col">Target</th>
              <th scope="col">Resolution</th>
            </tr>
          </thead>
          <tbody>
            {outline.relationships.map((relationship) => (
              <tr key={relationship.id}>
                <th scope="row">{relationship.source}</th>
                <td>{relationship.relationship}</td>
                <td>{relationship.target}</td>
                <td>{relationship.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No relationships were detected.</p>
      )}

      <h3>Structural findings</h3>
      {outline.findings.length > 0 ? (
        <ul>
          {outline.findings.map((finding, index) => (
            <li key={`${finding.code}:${finding.source}:${index}`}>
              <strong>{finding.code}</strong>: {finding.message} ({finding.source})
            </li>
          ))}
        </ul>
      ) : (
        <p>No structural findings.</p>
      )}
    </section>
  );
}
