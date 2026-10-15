import { SellForm } from "./SellForm";
import { isMuseEnabled } from "@/lib/ai/muse";
import { currentUser } from "@/lib/session";

export default async function SellPage() {
  await currentUser(); // Supabase 模式：未登入導向 /login
  return (
    <>
      <h1>拍照即上架</h1>
      <p className="lead">放一張照片、說一句話，AI 會填好品名、分類、成色與建議售價。你只需要確認。</p>
      <SellForm museEnabled={isMuseEnabled()} />
    </>
  );
}
