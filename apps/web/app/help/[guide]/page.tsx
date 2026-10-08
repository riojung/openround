import { notFound } from "next/navigation";
import { findHelpGuide, helpFeatureGuides } from "../../../lib/help-feature-guides";
import { FeatureGuidePage } from "../feature-guide";

export function generateStaticParams() {
  return helpFeatureGuides.map((guide) => ({ guide: guide.id }));
}

export default async function Page({ params }: { params: Promise<{ guide: string }> }) {
  const { guide: id } = await params;
  const guide = findHelpGuide(id);
  if (!guide) notFound();
  return <FeatureGuidePage guide={guide} />;
}
