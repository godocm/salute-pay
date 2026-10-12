import {
  ArrowRight,
  Check,
  FileSignature,
  Layers3,
  LockKeyhole,
  Wallet,
  Zap,
} from "lucide-react";

export function InfrastructureFlow({
  kind,
}: {
  kind: "orders" | "deploy" | "collect";
}) {
  return (
    <div
      className={`infra-flow infra-${kind}`}
      role="img"
      aria-label={
        kind === "orders"
          ? "Example orders get distinct addresses and matching deposit records."
          : kind === "deploy"
            ? "An off-chain signed EVM order is funded before an executor deploys and collects atomically."
            : "Independent executors collect to the same fixed merchant destination."
      }
    >
      <div className="infra-panel-top" aria-hidden="true">
        <span className="infra-signal" />
        {kind === "orders"
          ? "ORDER ACTIVITY"
          : kind === "deploy"
            ? "DEPLOYMENT FLOW"
            : "OPEN COLLECTION"}
        <small>ILLUSTRATION</small>
      </div>
      {kind === "orders" ? (
        <div className="infra-order-window" aria-hidden="true">
          <div className="infra-order-track">
            {[1042, 1043, 1044, 1045, 1042, 1043, 1044].map((id, index) => (
              <div className="infra-order-row" key={`${id}-${index}`}>
                <span className="infra-order-icon">
                  <FileSignature size={15} />
                </span>
                <div>
                  <b>Order #{id}</b>
                  <code>
                    {
                      ["0x7c…f91", "0x29…a04", "0xb8…e23", "0x63…b17"][
                        index % 4
                      ]
                    }
                  </code>
                </div>
                <span className="infra-order-match">
                  <Check size={12} />
                  {["Signed", "Funded", "Matched", "New order"][index % 4]}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : kind === "deploy" ? (
        <div className="infra-deployment" aria-hidden="true">
          <div className="infra-flow-rail">
            <span />
            <i />
          </div>
          <div className="infra-stage stage-sign">
            <span>
              <FileSignature size={20} />
            </span>
            <b>Sign order</b>
            <small>Off-chain</small>
          </div>
          <div className="infra-stage stage-fund">
            <span>
              <Wallet size={20} />
            </span>
            <b>Deposit</b>
            <small>Address funded</small>
          </div>
          <div className="infra-stage stage-deploy">
            <span>
              <Layers3 size={20} />
            </span>
            <b>Deploy + collect</b>
            <small>One transaction</small>
          </div>
          <div className="infra-deploy-caption">
            <Check size={12} /> No deployment for unpaid orders
          </div>
        </div>
      ) : (
        <div className="infra-collection" aria-hidden="true">
          <div className="infra-executors">
            {["A", "B", "C"].map((label) => (
              <span key={label}>
                <Zap size={12} /> {label}
              </span>
            ))}
            <small>Any executor</small>
          </div>
          <div className="infra-collect-route">
            <span />
            <i />
            <ArrowRight size={15} />
          </div>
          <div className="infra-merchant">
            <span>
              <Wallet size={24} />
              <LockKeyhole size={11} />
            </span>
            <b>Merchant</b>
            <small>Fixed destination</small>
          </div>
          <div className="infra-collect-caption">
            <Check size={12} /> Signed payout. No redirect.
          </div>
        </div>
      )}
    </div>
  );
}
