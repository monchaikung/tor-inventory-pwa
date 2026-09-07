from __future__ import annotations

import os
import sys
import webbrowser
from pathlib import Path

import pandas as pd
import streamlit as st
from dotenv import load_dotenv

from uk_car_advisor.advice import advise_model
from uk_car_advisor.compare import comparison_table
from uk_car_advisor.db import CarDatabase
from uk_car_advisor.dealers import build_dossier
from uk_car_advisor.models import SearchParams, VehicleResult
from uk_car_advisor.postcode import PostcodeError, is_valid_uk_postcode
from uk_car_advisor.search import run_search

load_dotenv()

DB_PATH = Path(os.environ.get("CARS_DB_PATH", "cars.db"))
FUEL_OPTIONS = ["Petrol", "Diesel", "Hybrid", "Electric"]
SOURCE_OPTIONS = {
    "Demo data (offline)": "demo",
    "AutoTrader": "autotrader",
    "Motors.co.uk": "motors",
    "Carwow": "carwow",
}


def open_in_browser(url: str) -> None:
    if sys.platform == "win32":
        webbrowser.open(f"microsoft-edge:{url}")
        return
    webbrowser.open(url)


def badge(value: bool | None, yes: str, no: str) -> str:
    if value is True:
        return yes
    if value is False:
        return no
    return "—"


def to_frame(vehicles: list[VehicleResult]) -> pd.DataFrame:
    rows = []
    for vehicle in vehicles:
        spec = vehicle.specifications
        rows.append(
            {
                "ID": vehicle.id,
                "Vehicle": vehicle.label,
                "Price (£)": vehicle.price_gbp,
                "Mileage": vehicle.mileage,
                "Trim": vehicle.trim or "—",
                "Seller": vehicle.seller_type.title(),
                "Distance (mi)": vehicle.location.distance_miles,
                "ULEZ": badge(spec.ulez_compliant, "ULEZ", "Non-ULEZ"),
                "MOT": spec.mot_status or "—",
                "Fuel": spec.fuel_type or "—",
                "Dealer / seller": vehicle.location.dealer_name,
                "Postcode": vehicle.location.postcode,
                "Listing": vehicle.listing_url,
            }
        )
    return pd.DataFrame(rows)


def get_db() -> CarDatabase:
    if "db" not in st.session_state:
        st.session_state.db = CarDatabase(DB_PATH)
    return st.session_state.db


def render_dealer_pane(vehicle: VehicleResult) -> None:
    db = get_db()
    dossier = build_dossier(db, vehicle, st.session_state.get("user_coords"))
    if dossier.is_private:
        st.subheader("Private sale")
        st.write(dossier.private_note)
        if dossier.dealer.postcode:
            st.write(f"**Area postcode:** {dossier.dealer.postcode}")
        if dossier.dealer.address:
            st.write(f"**Area:** {dossier.dealer.address}")
        if dossier.distance_miles is not None:
            st.write(f"**Distance:** {dossier.distance_miles} miles")
        return

    dealer = dossier.dealer
    st.subheader(dealer.name)
    if dealer.address:
        st.write(f"**Address:** {dealer.address}")
    loc_bits = [dealer.postcode]
    if dealer.admin_district:
        loc_bits.append(dealer.admin_district)
    st.write("**Postcode:** " + ", ".join(bit for bit in loc_bits if bit))
    if dossier.distance_miles is not None:
        st.write(f"**Distance:** {dossier.distance_miles} miles")
    if dealer.phone:
        st.write(f"**Phone:** {dealer.phone}")
    if dealer.website:
        st.write(f"**Website:** {dealer.website}")
        if st.button("Open dealer site", key=f"dealer-site-{vehicle.id}"):
            open_in_browser(dealer.website)
    if dealer.stock_url:
        st.caption(f"Stock page: {dealer.stock_url}")

    st.markdown("#### Other cars on sale")
    if not dossier.other_stock:
        st.info("No other stock stored for this dealer yet.")
        return
    stock_df = to_frame(dossier.other_stock).drop(columns=["ID"], errors="ignore")
    st.dataframe(stock_df, hide_index=True, width="stretch")


def render_model_pane(vehicle: VehicleResult) -> None:
    db = get_db()
    advice = advise_model(vehicle, db, search_id=st.session_state.get("search_id"))
    st.subheader(f"{advice.make} {advice.model}")
    if advice.years:
        st.caption(advice.years)
    if advice.fallback_note:
        st.warning(advice.fallback_note)

    stats = advice.stats
    c1, c2, c3, d1, d2 = st.columns(5)
    c1.metric("This car", f"£{advice.selected_price:,}" if advice.selected_price else "—")
    c2.metric("Local average", f"£{stats['average']:,}" if stats["average"] else "—")
    c3.metric("Median", f"£{stats['median']:,}" if stats["median"] else "—")
    d1.metric("Min", f"£{stats['min']:,}" if stats["min"] else "—")
    d2.metric("Max", f"£{stats['max']:,}" if stats["max"] else "—")
    st.write(f"**Price position:** {advice.position}  ·  **Sample size:** {stats['count']}")
    if stats.get("mileage_avg"):
        st.caption(f"Average mileage in sample: {stats['mileage_avg']:,} miles")

    costs = advice.running_costs
    st.markdown("#### Running costs")
    ulez = badge(costs.get("ulez_compliant"), "ULEZ compliant", "Not ULEZ")
    bits = [
        ulez,
        f"MOT: {costs.get('mot_status') or '—'}",
        f"Tax: {costs.get('tax_status') or '—'}",
        f"VED: £{costs['annual_tax_gbp']}" if costs.get("annual_tax_gbp") is not None else "VED: —",
        f"MPG: {costs.get('mpg_combined') or '—'}",
        f"Insurance: {costs.get('insurance_group') or '—'}",
    ]
    st.write(" · ".join(bits))

    st.markdown("#### Maintenance")
    st.write(f"**Service:** {advice.service_interval}")
    st.write(f"**Typical cost:** {advice.service_cost_band}")
    st.write(advice.running_notes)

    st.markdown("#### Common issues")
    for item in advice.common_issues:
        st.markdown(f"- {item}")
    st.markdown("#### When viewing")
    for item in advice.viewing_checks:
        st.markdown(f"- {item}")


def main() -> None:
    st.set_page_config(page_title="UK Car Advisor", layout="wide")
    st.title("UK Car Advisor")
    st.caption("Local used-car search for Windows 11 — postcode, comparison, dealer dossier, model advice.")

    with st.sidebar:
        st.header("Search")
        postcode = st.text_input("UK postcode", value="M1 1AE")
        radius = st.slider("Radius (miles)", min_value=1, max_value=100, value=25)
        budget = st.number_input("Max budget (£)", min_value=500, max_value=100000, value=15000, step=250)
        fuel = st.multiselect("Fuel type", FUEL_OPTIONS, default=["Petrol", "Hybrid"])
        features_raw = st.text_input("Desired features (comma separated)", value="")
        source_labels = st.multiselect(
            "Sources",
            list(SOURCE_OPTIONS.keys()),
            default=["Demo data (offline)"],
        )
        headed_default = sys.platform == "win32"
        headed = st.checkbox("Headed Playwright (live sites)", value=headed_default)
        run = st.button("Search", type="primary", width="stretch")

    if run:
        if not is_valid_uk_postcode(postcode):
            st.error(f"Not a valid UK postcode: {postcode}")
            return
        if not source_labels:
            st.error("Select at least one source.")
            return
        sources = [SOURCE_OPTIONS[label] for label in source_labels]
        features = [part.strip() for part in features_raw.split(",") if part.strip()]
        params = SearchParams(
            postcode=postcode,
            radius_miles=int(radius),
            budget_max=int(budget),
            fuel_type=list(fuel),
            features=features,
        )
        with st.spinner("Searching listings…"):
            try:
                outcome = run_search(
                    params,
                    sources=sources,
                    headed=headed,
                    db=get_db(),
                )
            except PostcodeError as exc:
                st.error(str(exc))
                return
        st.session_state.outcome = outcome
        st.session_state.search_id = outcome.search_id
        st.session_state.user_coords = outcome.user_coords
        st.session_state.vehicles = outcome.vehicles

    vehicles: list[VehicleResult] = st.session_state.get("vehicles") or []
    outcome = st.session_state.get("outcome")
    if outcome and outcome.errors:
        for err in outcome.errors:
            st.warning(err)
    if not vehicles:
        st.info("Set a UK postcode and search. Demo data works fully offline.")
        return

    st.success(f"{len(vehicles)} listing(s) stored in cars.db (search #{st.session_state.get('search_id')}).")
    frame = to_frame(vehicles)
    display = frame.drop(columns=["ID"])
    st.dataframe(display, hide_index=True, width="stretch")

    labels = []
    for vehicle in vehicles:
        price = f"£{vehicle.price_gbp:,}" if vehicle.price_gbp is not None else "—"
        labels.append(f"{vehicle.label} · {price} · {vehicle.location.dealer_name}")

    selected_label = st.selectbox("Select a listing for dealer & model advice", labels)
    selected = vehicles[labels.index(selected_label)]

    actions = st.columns([1, 1, 2])
    with actions[0]:
        if st.button("Open listing"):
            open_in_browser(selected.listing_url)
    with actions[1]:
        st.caption(selected.listing_url)

    dealer_col, model_col = st.columns(2)
    with dealer_col:
        render_dealer_pane(selected)
    with model_col:
        render_model_pane(selected)

    st.markdown("---")
    st.subheader("Side-by-side comparison")
    compare_labels = st.multiselect(
        "Compare 2–3 cars",
        labels,
        default=labels[: min(2, len(labels))],
        max_selections=3,
    )
    if len(compare_labels) >= 2:
        chosen = [vehicles[labels.index(item)] for item in compare_labels]
        table = comparison_table(chosen)
        st.dataframe(pd.DataFrame(table), width="stretch")
    else:
        st.caption("Pick at least two listings to compare.")


if __name__ == "__main__":
    main()
