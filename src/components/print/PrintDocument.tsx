import { Fragment } from "react";
import type { PrintableCrate, PrintableDesign, PrintableLabel, Row } from "@/lib/printable";
import { DrawingSvg } from "./DrawingSvg";

/**
 * The export document (#26) as Letter pages: the crate spec, a build sheet per crate type and a
 * shipping label per crate type. A pure render of `PrintableDesign`: every number and sentence
 * comes from the model, so a PDF export (#51) can lay out the same content.
 */
export function PrintDocument({ doc }: { doc: PrintableDesign }) {
  if (doc.problem) {
    return (
      <section className="sheet" aria-label="Crate spec">
        <Header doc={doc} kind="Crate spec" />
        <p className="problem">{doc.problem}</p>
      </section>
    );
  }
  return (
    <>
      <section className="sheet" aria-label="Crate spec">
        <Header doc={doc} kind="Crate spec · PM and logistics" />
        <div className="cols">
          <div>
            <h3>Part</h3>
            <Rows rows={doc.part} />
          </div>
          {doc.shipment.split && (
            <div className="plan" aria-label="Shipment plan">
              <h3>Shipment</h3>
              <p className="ships">{doc.shipment.text}</p>
              <Rows rows={doc.shipment.rows} />
              {doc.shipment.unmet && <p className="unmet">{doc.shipment.unmet}</p>}
            </div>
          )}
        </div>
        {doc.crates.map((c) => (
          <CrateSpec key={c.letter} crate={c} split={doc.shipment.split} />
        ))}
      </section>
      {doc.crates.map((c) => (
        <BuildSheet key={c.letter} doc={doc} crate={c} />
      ))}
      {doc.crates.map((c) => (
        <section key={c.letter} className="sheet label-sheet" aria-label={`Shipping label${doc.shipment.split ? `, crate ${c.letter}` : ""}`}>
          <ShippingLabel label={c.label} />
        </section>
      ))}
    </>
  );
}

function Header({ doc, kind }: { doc: PrintableDesign; kind: string }) {
  return (
    <header className="doc-head">
      <div>
        <div className="eyebrow">{kind}</div>
        <h1>{doc.title}</h1>
      </div>
      <div className="meta">
        <div>Crate Designer · {doc.date}</div>
        <div>{doc.unitsNote}</div>
      </div>
    </header>
  );
}

function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl className="rows">
      {rows.map((r) => (
        <Fragment key={r.label}>
          <dt>{r.label}</dt>
          <dd>
            <b>{r.value}</b>
            {r.note && <small>{r.note}</small>}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

function CrateSpec({ crate: c, split }: { crate: PrintableCrate; split: boolean }) {
  return (
    <section className="crate-spec" aria-label={c.heading}>
      <h2>{split ? c.heading : "The crate"}</h2>
      <div className="cols">
        <div>
          <h3>Size and weight</h3>
          <Rows rows={c.spec.rows} />
        </div>
        <div>
          <h3>Freight</h3>
          <Rows rows={c.spec.freight} />
        </div>
      </div>
      <h3>Layout</h3>
      <p>
        <b>{c.spec.layout.chosen}.</b> {c.spec.layout.why}
      </p>
      {c.spec.layout.runnerUp && <p className="soft">Runner-up: {c.spec.layout.runnerUp}</p>}
      <h3>Checks</h3>
      <table className="checks">
        <tbody>
          {c.spec.checks.map((k) => (
            <tr key={k.id} className={`lvl-${k.level}`}>
              <td className="lvl">{k.levelText}</td>
              <td>
                <b>{k.title}.</b> {k.detail}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function BuildSheet({ doc, crate: c }: { doc: PrintableDesign; crate: PrintableCrate }) {
  const [top, front, end, plan, side] = c.build.drawings;
  const name = doc.shipment.split ? `Build sheet · crate ${c.letter} (build ${c.count})` : "Build sheet · shop";
  return (
    <>
      <section className="sheet" aria-label={doc.shipment.split ? `Build sheet, crate ${c.letter}` : "Build sheet"}>
        <Header doc={doc} kind={name} />
        <h2>{c.heading}</h2>
        <p className="soft">{c.build.dimsNote}. Outside views, then sections through the load (parts dashed, cut boards hatched).</p>
        <div className="views">
          {[top, front, end].map((d) => (
            <figure key={d.id}>
              <DrawingSvg drawing={d} boxW={330} boxH={200} />
              <figcaption>{d.title}</figcaption>
            </figure>
          ))}
        </div>
        <div className="views">
          {[plan, side].map((d) => (
            <figure key={d.id}>
              <DrawingSvg drawing={d} boxW={330} boxH={230} />
              <figcaption>{d.title}</figcaption>
            </figure>
          ))}
        </div>
      </section>
      <section className="sheet" aria-label={doc.shipment.split ? `Cut list and assembly, crate ${c.letter}` : "Cut list and assembly"}>
        <Header doc={doc} kind={name} />
        <h2>Cut list by stock{doc.shipment.split ? `, one crate ${c.letter}` : ""}</h2>
        <table className="cutlist">
          <thead>
            <tr>
              <th>Piece</th>
              <th>Assembly</th>
              <th>Cut</th>
              <th className="n">Qty</th>
            </tr>
          </thead>
          {c.build.cutList.map((g) => (
            <tbody key={g.stock}>
              <tr className="stock-head">
                <td colSpan={2}>{g.stock}</td>
                <td>{g.total}</td>
                <td className="n">{g.pieces}</td>
              </tr>
              {g.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.piece}</td>
                  <td>{l.assembly}</td>
                  <td>{l.cut}</td>
                  <td className="n">{l.qty}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
        <div className="stock-totals">
          {c.build.totals.map((t) => (
            <div key={t.label}>
              <b>{t.value}</b> {t.label.toLowerCase()}
            </div>
          ))}
        </div>
        <div className="cols">
          <div>
            <h3>Fasteners</h3>
            <table className="fasteners">
              <tbody>
                {c.build.fasteners.map((f) => (
                  <tr key={f.title}>
                    <td>
                      <b>{f.title}</b>
                      <small>{f.rule}</small>
                    </td>
                    <td className="n">{f.qty}</td>
                  </tr>
                ))}
                <tr className="sum">
                  <td>Wood screws, about</td>
                  <td className="n">{c.build.fastenerTotal}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div>
            <h3>Assembly order</h3>
            <ol className="steps">
              {c.build.steps.map((s) => (
                <li key={s.n}>
                  <b>{s.title}</b>
                  {s.screws > 0 && <span className="screws"> · {s.screws} screws</span>}
                  <p>{s.text}</p>
                  {s.pieces.length > 0 && (
                    <p className="pieces">{s.pieces.map((p) => `${p.qty} × ${p.piece.toLowerCase()} (${p.stock}, ${p.cut})`).join("; ")}</p>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>
    </>
  );
}

/** The dock label: what is inside, how heavy, which way up, where the forks go. */
function ShippingLabel({ label: l }: { label: PrintableLabel }) {
  return (
    <div className="label">
      <div className="label-top">
        <div>
          <div className="eyebrow">Part number</div>
          <div className="part-no">{l.partId}</div>
          <div className="part-name">{l.partName}</div>
        </div>
        <UpArrows />
      </div>
      {l.crate && <div className="label-crate">{l.crate}</div>}
      <div className="label-grid">
        <div>
          <div className="eyebrow">Quantity</div>
          <div className="l-big">{l.quantity}</div>
        </div>
        <div>
          <div className="eyebrow">Gross weight</div>
          <div className="l-big">{l.gross}</div>
          <div className="other">{l.grossOther}</div>
        </div>
        <div>
          <div className="eyebrow">Outside L × W × H</div>
          <div className="mid">{l.outside}</div>
        </div>
      </div>
      <div className="this-side-up">THIS SIDE UP</div>
      <EndMarks label={l} />
      <div className="fork-note">{l.forkEntry.toUpperCase()}</div>
    </div>
  );
}

/** The ISO 780 "this way up" mark: two arrows over a bar. */
function UpArrows() {
  const arrow = (x: number) => <path key={x} d={`M${x} 8 L${x + 14} 30 H${x + 6} V70 H${x - 6} V30 H${x - 14} Z`} fill="#000" />;
  return (
    <svg className="up-arrows" viewBox="0 0 80 84" width="120" height="126" role="img" aria-label="This side up">
      {arrow(24)}
      {arrow(56)}
      <rect x="6" y="74" width="68" height="6" fill="#000" />
    </svg>
  );
}

/** The crate's end, with the skids, fork-entry arrows between them and the centre of gravity when known. */
function EndMarks({ label: l }: { label: PrintableLabel }) {
  const s = 560 / Math.max(l.widthMm, l.heightMm * 1.6);
  const W = l.widthMm * s;
  const H = l.heightMm * s;
  const skidH = l.skidTallMm * s;
  const pad = 30;
  // The openings the handling checks measured (#8), so the arrows match them.
  const gaps = l.openings.map((o) => ({ from: o.y * s, to: (o.y + o.w) * s })).filter((g) => g.to - g.from > 4);
  return (
    <svg className="end-marks" viewBox={`${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad + 40}`} width="100%" role="img" aria-label="Crate end with fork entry marks">
      <rect x="0" y="0" width={W} height={H - skidH} fill="#fff" stroke="#000" strokeWidth="2" />
      {l.skids.map((k, i) => (
        <rect key={i} x={k.y * s} y={H - skidH} width={k.w * s} height={skidH} fill="#000" />
      ))}
      {gaps.map((g, i) => {
        const cx = (g.from + g.to) / 2;
        // An arrow pointing up into the opening between two skids.
        return (
          <g key={i}>
            <path d={`M${cx} ${H - skidH / 2} L${cx - 10} ${H + 6} H${cx - 4} V${H + 26} H${cx + 4} V${H + 6} H${cx + 10} Z`} fill="#000" />
            <text x={cx} y={H + 46} textAnchor="middle" fontSize="16" fontWeight="700" fontFamily="var(--sans)">
              FORKS
            </text>
          </g>
        );
      })}
      {l.cogEnd && (
        <g aria-label="Centre of gravity">
          <circle cx={l.cogEnd.y * s} cy={H - l.cogEnd.z * s} r="14" fill="#fff" stroke="#000" strokeWidth="2" />
          <path d={`M${l.cogEnd.y * s} ${H - l.cogEnd.z * s - 14} A14 14 0 0 1 ${l.cogEnd.y * s + 14} ${H - l.cogEnd.z * s} H${l.cogEnd.y * s} Z`} fill="#000" />
          <path d={`M${l.cogEnd.y * s} ${H - l.cogEnd.z * s + 14} A14 14 0 0 1 ${l.cogEnd.y * s - 14} ${H - l.cogEnd.z * s} H${l.cogEnd.y * s} Z`} fill="#000" />
          <text x={l.cogEnd.y * s + 20} y={H - l.cogEnd.z * s + 5} fontSize="14" fontFamily="var(--sans)">
            CENTRE OF GRAVITY
          </text>
        </g>
      )}
    </svg>
  );
}
