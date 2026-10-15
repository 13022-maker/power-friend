import Link from "next/link";

export default function NotFound() {
  return (
    <div className="empty" style={{ marginTop: 40 }}>
      找不到這個頁面，或你沒有權限查看。<br />
      <Link href="/" style={{ textDecoration: "underline" }}>回探索</Link>
    </div>
  );
}
