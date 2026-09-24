import { PresentationBuilder } from "../../../components/presentation/presentation-builder";
import { WorkspaceProvider } from "../../../components/workspace/workspace-provider";

export default async function PresentationBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <WorkspaceProvider>
      <PresentationBuilder presentationId={id} />
    </WorkspaceProvider>
  );
}
