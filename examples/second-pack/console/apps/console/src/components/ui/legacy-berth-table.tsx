/** The first berth list, superseded by BerthGrid. Nothing should import it now. */
export function LegacyBerthTable({ names }: { names: string[] }) {
  return (
    <ul className="text-body text-fg">
      {names.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}
