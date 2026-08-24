import Link from "next/link";

export default function Home() {
  const endpoints = [
    ["POST /api/auth/register", "Create account"],
    ["POST /api/auth/login", "Login → JWT"],
    ["GET /api/auth/me", "Current user + balances"],
    ["POST /api/wallet/deposit", "Deposit money"],
    ["POST /api/wallet/withdraw", "Withdraw money"],
    ["GET /api/wallet", "Balances + gold holding"],
    ["GET /api/wallet/transactions", "Transaction history (filter/paginate)"],
    ["POST /api/trades/buy", "Buy gold"],
    ["POST /api/trades/sell", "Sell gold"],
    ["GET /api/trades", "Trade history (filter/paginate)"],
    ["GET /api/price", "Current gold price"],
    ["GET /api/broadcasts", "Active broadcasts"],
    ["GET /api/admin/users", "Admin: all users"],
    ["GET /api/admin/transactions", "Admin: all transactions"],
    ["POST /api/admin/users/[id]/adjust", "Admin: adjust balance"],
    ["DELETE /api/admin/users/[id]", "Admin: soft delete user"],
  ];

  return (
    <main style={{ fontFamily: "monospace", padding: 32, maxWidth: 720, margin: "0 auto" }}>
      <h1>Gold Trading System — API</h1>
      <p>
        Backend candidate task. Full REST API documentation lives in{" "}
        <code>README.md</code>. Headers: <code>Authorization: Bearer &lt;token&gt;</code>.
      </p>
      <h2>Endpoints</h2>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <tbody>
          {endpoints.map(([endpoint, desc]) => (
            <tr key={endpoint}>
              <td style={{ border: "1px solid #ddd", padding: 6 }}>
                <code>{endpoint}</code>
              </td>
              <td style={{ border: "1px solid #ddd", padding: 6 }}>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}