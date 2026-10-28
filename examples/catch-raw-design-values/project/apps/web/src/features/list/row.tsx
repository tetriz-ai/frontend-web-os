export function Row({ title }: { title: string }) {
  return (
    <li className="flex gap-2 bg-white p-3 text-sm text-[#1f2937] rounded-xl">
      <span className="text-fg">{title}</span>
    </li>
  );
}
