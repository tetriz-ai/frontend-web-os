export default async function SettingsPage({ params }: { params: Promise<{ section: string[] }> }) {
  const { section } = await params;
  return <h1 className="text-title">Settings: {section.join(' / ')}</h1>;
}
