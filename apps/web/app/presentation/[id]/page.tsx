import { PresentationBuilder } from "../../../components/presentation/presentation-builder";
import { WorkspaceProvider } from "../../../components/workspace/workspace-provider";
import { WorkspaceFeatureGate } from "../../../components/workspace/workspace-shell";

export default async function PresentationBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <WorkspaceProvider>
      <WorkspaceFeatureGate feature="presentations">
        <PresentationBuilder presentationId={id} />
      </WorkspaceFeatureGate>
    </WorkspaceProvider>
  );
}
