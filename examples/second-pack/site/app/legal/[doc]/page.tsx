export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  return <h1 className="text-title text-fg">{doc === 'terms' ? 'Terms of service' : 'Privacy notice'}</h1>;
}
