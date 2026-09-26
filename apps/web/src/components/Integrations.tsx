import { useState } from "react";
import { Link2, Plug, Save } from "lucide-react";
import type { Command, State } from "../types";

type Connector = State["integrations"]["telemetry"];
type WalletConnector = State["integrations"]["wallet"];
type WalletProvider = {
  request(args: { method: string }): Promise<unknown>;
};
declare global {
  interface Window {
    ethereum?: WalletProvider;
  }
}

const blank: State["integrations"] = {
  telemetry: { provider: "", endpoint_url: "", enabled: false },
  inventory: { provider: "", endpoint_url: "", enabled: false },
  workforce: { provider: "", endpoint_url: "", enabled: false },
  wallet: {
    provider: "", rpc_url: "", chain_id: "", contract_address: "",
    wallet_connect_project_id: "", enabled: false,
  },
};

function ConnectorCard({ title, description, value, onChange }: {
  title: string;
  description: string;
  value: Connector;
  onChange: (next: Connector) => void;
}) {
  return <section className="panel connector-card">
    <div className="panel-heading"><div><h2>{title}</h2><p>{description}</p></div></div>
    <div className="connector-fields">
      <label className="field">Provider<input value={value.provider} onChange={(e) => onChange({ ...value, provider: e.target.value })} placeholder="Optional" /></label>
      <label className="field">API endpoint<input type="url" value={value.endpoint_url} onChange={(e) => onChange({ ...value, endpoint_url: e.target.value })} placeholder="https://" /></label>
    </div>
  </section>;
}

export function Integrations({ state, command, busy }: { state: State; command: Command; busy: boolean }) {
  const [settings, setSettings] = useState<State["integrations"]>(state.integrations ?? blank);
  const [walletAddress, setWalletAddress] = useState("");
  const [walletChain, setWalletChain] = useState("");
  const [walletError, setWalletError] = useState("");
  async function connectWallet() {
    setWalletError("");
    if (!window.ethereum) {
      setWalletError("No browser wallet was found. Install a wallet extension to connect.");
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      const chain = await window.ethereum.request({ method: "eth_chainId" }) as string;
      setWalletAddress(accounts[0] ?? "");
      setWalletChain(chain);
    } catch {
      setWalletError("Wallet connection was cancelled or unavailable.");
    }
  }
  function updateWallet(next: WalletConnector) {
    setSettings((current) => ({ ...current, wallet: next }));
  }
  return <>
    <div className="page-heading"><div><h1>Connections</h1></div></div>
    <div className="connector-grid">
      <ConnectorCard title="Equipment data" description="Telemetry and SCADA" value={settings.telemetry} onChange={(telemetry) => setSettings((current) => ({ ...current, telemetry }))} />
      <ConnectorCard title="Inventory" description="Stock and purchasing" value={settings.inventory} onChange={(inventory) => setSettings((current) => ({ ...current, inventory }))} />
      <ConnectorCard title="Workers" description="Directory and dispatch" value={settings.workforce} onChange={(workforce) => setSettings((current) => ({ ...current, workforce }))} />
      <section className="panel connector-card">
        <div className="panel-heading"><div><h2>Wallet</h2><p>Connect a browser wallet and enter chain details when ready.</p></div></div>
        <div className="connector-fields">
          <label className="field">Provider<input value={settings.wallet.provider} onChange={(e) => updateWallet({ ...settings.wallet, provider: e.target.value })} placeholder="Optional" /></label>
          <label className="field">RPC endpoint<input type="url" value={settings.wallet.rpc_url} onChange={(e) => updateWallet({ ...settings.wallet, rpc_url: e.target.value })} placeholder="https://" /></label>
          <div className="connector-fields two">
            <label className="field">Chain ID<input value={settings.wallet.chain_id} onChange={(e) => updateWallet({ ...settings.wallet, chain_id: e.target.value })} placeholder="" /></label>
            <label className="field">Contract address<input value={settings.wallet.contract_address} onChange={(e) => updateWallet({ ...settings.wallet, contract_address: e.target.value })} placeholder="" /></label>
          </div>
          <label className="field">WalletConnect project ID<input value={settings.wallet.wallet_connect_project_id} onChange={(e) => updateWallet({ ...settings.wallet, wallet_connect_project_id: e.target.value })} placeholder="Optional" /></label>
          <div className="wallet-link-row"><button className="button secondary" onClick={() => void connectWallet()}><Link2 size={15} /> Connect wallet</button>{walletAddress && <span className="wallet-address">{walletAddress.slice(0, 6)}…{walletAddress.slice(-4)} · {walletChain}</span>}</div>
          {walletError && <p className="connector-note" role="status">{walletError}</p>}
        </div>
      </section>
    </div>
    <p className="connector-note"><Plug size={14} /> Connection details only. Keep private API credentials in server environment secrets.</p>
    <button className="button primary connector-save" disabled={busy} onClick={() => void command("/integrations", {
      telemetry: { ...settings.telemetry, enabled: false },
      inventory: { ...settings.inventory, enabled: false },
      workforce: { ...settings.workforce, enabled: false },
      wallet: { ...settings.wallet, enabled: false },
    }, "PUT")}><Save size={15} /> Save connections</button>
  </>;
}
