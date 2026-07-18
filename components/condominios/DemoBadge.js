export default function DemoBadge() {
  if (process.env.NEXT_PUBLIC_APP_ENV !== "demo") return null;

  return (
    <span
      role="status"
      aria-label="Ambiente demo"
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        padding: "3px 8px",
        background: "#fef3c7",
        border: "1px solid #f59e0b",
        color: "#92400e",
        fontSize: 10,
        fontWeight: 900,
        letterSpacing: 0.8,
      }}
    >
      DEMO
    </span>
  );
}
