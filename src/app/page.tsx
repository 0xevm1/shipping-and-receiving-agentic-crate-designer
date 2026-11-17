import { DesignerShell } from "@/components/shell/DesignerShell";
import { StandardsLoader } from "@/components/shell/StandardsLoader";

export default function Home() {
  return (
    <>
      <StandardsLoader />
      <DesignerShell />
    </>
  );
}
