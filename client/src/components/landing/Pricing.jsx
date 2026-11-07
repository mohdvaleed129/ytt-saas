import { Link } from 'react-router';

export default function Pricing() {
  return (
    <section className="section" id="pricing" aria-labelledby="pricing-title">
      <div className="container pricing">
        <h2 id="pricing-title">Pricing</h2>
        <div className="ticket pricing__ticket">
          <div className="ticket__band"><span>Fare</span><span>Not published</span></div>
          <div className="ticket__body">
            <p className="pricing__line">Plans and prices have not been published yet.</p>
            <p>There are no accounts or payments in this version, so nothing here can charge you. Try the generator as it is today.</p>
            <p><Link className="btn btn--small" to="/generator">Open the generator</Link></p>
          </div>
        </div>
      </div>
    </section>
  );
}
