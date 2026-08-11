# QC2GO Checklists

Every checklist that ships with the app, with all sections and checkpoints. Generated
from `src/templates/` — run `npm run checklists:export` to refresh.

> **This lists the shipped checklists only.** Admins can edit checklists and
> add their own in the app; those live in that device's local storage and are
> not reflected here. A checklist edited in the app no longer matches this
> document until the change is made in `src/templates/` as well.

## Every checklist opens with these two blocks

Prepended automatically to all 5 checklists, so a company-wide change is made once.

### 1. Job Information

| Field | Type | Required | Prefilled from job |
| --- | --- | :---: | --- |
| Project name | text | Yes | name |
| Customer name | text | Yes | customerName |
| Job address | text | Yes | address |
| Salesperson | text | Yes | salesperson |
| Team leader | text | Yes | teamLeader |
| Job / work order # | text | — | jobNumber |
| Permit # | text | — | — |
| Inspected by | text | Yes | — |
| Inspection date | date | Yes | — |
| Crew members on site | text | — | — |
| Customer present for walkthrough | select (Yes, No) | Yes | — |
| Outdoor temp (°F) | number | — | — |
| Utility / rebate program | text | — | — |

### 2. Universal QC Standards

*Applies to every job, every visit type.*

1. **Installed work matches the signed scope of work / proposal**  
    `Critical`  
    *Compare equipment, quantities, and locations against the sold proposal line by line.*
2. **Any deviations from scope are documented on a signed change order**  
    `Critical`  
    *Verbal approvals do not count. If the crew changed anything, there is paperwork.*
3. **Permits pulled, posted on site, and required inspections scheduled or passed**
4. **All equipment model and serial numbers recorded and photographed**  
    `Photo for record`  
    *Shoot the data plate straight on and legible — this is the warranty record.*
5. **Manufacturer warranty registration submitted**  
    *Extended warranties are void if registration is missed inside the window.*
6. **Floor and surface protection was used; no damage to interior finishes**
7. **Work areas cleaned; all debris, packaging, and old equipment removed from property**  
    `Photo for record`
8. **No damage to siding, roofing, landscaping, or driveway**
9. **All exterior penetrations sealed, flashed, and weather-tight**  
    `Photo for record`  
    *Check every hole made today: line sets, vents, condensate, wiring.*
10. **Equipment, disconnects, and breakers are labeled and accessible**
11. **Working CO and smoke alarms present on every level with combustion appliances**  
    `Critical`
12. **Existing combustion appliances checked for proper draft and no spillage**  
    `Critical`  
    *Required any time the building envelope or air balance was changed.*
13. **System started, run through a full cycle, and left operating correctly**  
    `Critical`
14. **Customer walkthrough completed and system operation demonstrated**
15. **Customer trained on controls, filter service intervals, and seasonal changeover**
16. **Manuals, warranty paperwork, and spare filters left with customer**
17. **Customer given service contact information and knows who to call**
18. **Customer states they are satisfied with the completed work**  
    `Critical`  
    *If No, capture their words verbatim in the explanation.*

## Summary

| # | Checklist | Category | Sections | Yes/No checkpoints | Measurements | Total items |
| :-: | --- | --- | :-: | :-: | :-: | :-: |
| 1 | Home Performance — Insulation & Air Sealing | Home Performance | 6 | 45 | 4 | 49 |
| 2 | Indoor Air Quality — Ventilation, Filtration & Humidity | Indoor Air Quality | 6 | 44 | 4 | 48 |
| 3 | Mitsubishi Ducted Hyper-Heat Heat Pump | Mitsubishi Ducted | 6 | 60 | 4 | 64 |
| 4 | Mitsubishi Ductless Hyper-Heat Heat Pump | Mitsubishi Ductless | 7 | 59 | 2 | 61 |
| 5 | Quilt Ductless Heat Pump | Quilt | 7 | 64 | 2 | 66 |

*Counts include the shared Universal QC Standards section, which runs first on every checklist.*

---

## Home Performance — Insulation & Air Sealing

**Category:** Home Performance  
**Use for:** Attic, wall, basement and crawlspace air sealing and insulation work.  
**Size:** 5 system sections (49 items including the universal block)

> Runs after **Universal QC Standards**.

### Preparation & Safety

1. **Knob-and-tube or unsafe wiring identified and cleared before insulating**  
    `Critical`  
    *No insulation buried over active knob-and-tube. Document the electrician sign-off.*
2. **All junction boxes accessible, covered, and not buried in insulation**
3. **Recessed lights are IC-rated or fitted with approved airtight covers**  
    `Critical`
4. **Chimney and flue chases dammed with fire-rated material and high-temp sealant**  
    `Critical`  
    *Sheet metal plus high-temp caulk, correct clearance to combustibles.*
5. **No active moisture, mold, or roof leaks in the work area**  
    `Critical`  
    *Insulating over a wet deck buries the problem. Stop and report.*
6. **Pre-existing conditions photographed before work started**  
    `Photo for record`

### Air Sealing

*Air sealing is completed and inspected before insulation goes in.*

1. **Top plates, wire and pipe penetrations sealed at the attic floor**  
    `Photo for record`
2. **Open chases, soffits, and dropped ceilings capped and sealed**
3. **Attic hatch or scuttle insulated, weatherstripped, and dammed**  
    `Photo for record`
4. **Rim / band joist air sealed and insulated to spec**  
    `Photo for record`
5. **Accessible ductwork sealed with mastic at all joints and boots**
6. **Bath and kitchen exhaust fans ducted to the exterior, never into the attic**  
    `Critical`
7. **Sill plate and foundation-to-framing joint sealed**

### Insulation Installation

1. **Installed R-value matches the contracted specification**  
    `Critical`
2. **Depth markers installed and readable; coverage is even with no voids**  
    `Photo for record`
3. **Baffles installed at every eave; soffit ventilation is not blocked**  
    `Photo for record`
4. **Kneewalls insulated and air sealed with rigid backing on the attic side**
5. **Dense-pack sidewall cavities filled to target density with no settling voids**  
    *Verify by feel and by bag count against square footage.*
6. **Drill holes plugged, patched, and finished to match the existing siding**  
    `Photo for record`
7. **Required clearances maintained at flues, heat-producing fixtures, and equipment**  
    `Critical`

### Crawlspace & Basement

1. **Vapor barrier covers full floor, seams overlapped and sealed, run up the walls**  
    `Photo for record`
2. **Foundation walls insulated per spec with required termite inspection gap**
3. **Vents sealed or left open per the design; approach matches the scope**
4. **No standing water; drainage and sump function verified**  
    `Critical`

### Testing & Verification

1. **Post-work blower door test performed and results documented**  
    `Critical` · `Photo for record`
2. **Pre-work CFM50**  
    `Measurement — CFM50`
3. **Post-work CFM50**  
    `Measurement — CFM50`
4. **Post-work ACH50**  
    `Measurement — ACH50`
5. **Combustion safety test (draft, spillage, ambient CO) passed after air sealing**  
    `Critical` · `Photo for record`  
    *Worst-case depressurization test on every atmospheric appliance.*
6. **Highest ambient CO reading**  
    `Measurement — ppm`
7. **Whole-house ventilation still adequate for the tightened envelope**  
    `Critical`  
    *If the house went below the ventilation threshold, mechanical ventilation is required.*

---

## Indoor Air Quality — Ventilation, Filtration & Humidity

**Category:** Indoor Air Quality  
**Use for:** ERV/HRV, exhaust ventilation, filtration, dehumidification and controls.  
**Size:** 5 system sections (48 items including the universal block)

> Runs after **Universal QC Standards**.

### ERV / HRV Installation

1. **Unit model matches the design and is sized for the home**  
    `Critical`
2. **Unit mounted level and securely, with service clearance for filter and core access**  
    `Photo for record`
3. **Condensate drain installed, trapped per manufacturer, and flow tested with water**  
    `Critical`
4. **Fresh air intake meets required separation from exhausts, flues, and contamination sources**  
    `Critical` · `Photo for record`  
    *Check distances to dryer vents, plumbing stacks, driveways, and combustion terminations.*
5. **Exterior hoods fitted with screens and backdraft dampers, sealed and flashed at the wall**  
    `Photo for record`
6. **Ducts in unconditioned space are insulated and vapor sealed against condensation**  
    `Critical`
7. **Duct runs supported, no kinks, crushed sections, or excess flex**
8. **Supply and exhaust airflows measured and balanced within manufacturer tolerance**  
    `Critical` · `Photo for record`
9. **Measured supply airflow**  
    `Measurement — CFM`
10. **Measured exhaust airflow**  
    `Measurement — CFM`
11. **Delivered ventilation rate meets the ASHRAE 62.2 target for this home**  
    `Critical`

### Exhaust Ventilation

1. **Bath fans deliver rated airflow and are quiet at the specified sone level**  
    `Photo for record`
2. **Fan switches, timers, or humidistats installed, labeled, and functioning**
3. **Dryer and range exhaust terminate outdoors with no lint or grease restriction**
4. **Makeup air provided where required by the exhaust load**  
    `Critical`

### Filtration & Air Cleaning

1. **Media cabinet correctly sized, airtight, and installed in the right airflow direction**  
    `Photo for record`
2. **Filter is accessible without tools; size and change interval labeled at the unit**  
    `Photo for record`
3. **Total external static pressure with the new filter is within equipment limits**  
    `Critical`
4. **Total external static pressure**  
    `Measurement — in. w.c.`
5. **No air bypasses the filter — cabinet and return joints are sealed**
6. **UV or air purification equipment installed per manufacturer with safety interlocks**

### Humidity Control

1. **Dehumidifier mounted level with required clearance and vibration isolation**
2. **Dehumidifier drain sloped and trapped, or condensate pump wired with safety switch**  
    `Critical`
3. **Ducted dehumidifier tie-ins do not short-cycle or pressurize the return incorrectly**
4. **Humidifier (if installed) has a working humidistat, drain, and bypass damper set for season**
5. **Indoor relative humidity at time of inspection**  
    `Measurement — % RH`

### Commissioning & Handoff

1. **Ventilation schedule and setpoints programmed for this home, not left at defaults**  
    `Critical` · `Photo for record`
2. **Combustion appliances re-tested for backdraft with all exhaust running at worst case**  
    `Critical`
3. **IAQ monitor (if supplied) placed, connected, and reading plausible values**
4. **Customer shown how to run, service, and seasonally adjust the ventilation system**

---

## Mitsubishi Ducted Hyper-Heat Heat Pump

**Category:** Mitsubishi Ducted  
**Use for:** Ducted air handlers and horizontal-ducted indoor units on hyper-heating outdoor units.  
**Size:** 5 system sections (64 items including the universal block)

> Runs after **Universal QC Standards**.

### Outdoor Unit

1. **Outdoor unit model matches the Manual J load calculation and the sold proposal**  
    `Critical` · `Photo for record`
2. **Unit level on a solid pad or wall bracket, elevated above expected snow depth**  
    `Critical` · `Photo for record`  
    *Hyper-heat units run in deep winter — base must stay clear of drifting and meltwater.*
3. **Manufacturer service and airflow clearances met on all sides and above**
4. **Vibration isolation pads installed; unit secured against wind, seismic, or snow load as required**
5. **Defrost meltwater drains away freely and will not ice under the unit or on a walkway**  
    `Critical`
6. **Base pan heater installed and wired where the application requires it**
7. **Unit not located under a roof drip line or icicle fall path**

### Line Set & Refrigerant

1. **Line set diameter and total length are within manufacturer limits for this pairing**  
    `Critical`
2. **Nitrogen purge used during all brazing**  
    `Critical`
3. **Flares cut, deburred, and torqued to Mitsubishi specification with a torque wrench**  
    `Critical`  
    *No over-tightening. Torque values are per line size in the install manual.*
4. **Pressure test held at specified pressure with no loss**  
    `Critical` · `Photo for record`
5. **Evacuated to 500 microns or below with a documented decay test**  
    `Critical` · `Photo for record`
6. **Final micron reading after decay test**  
    `Measurement — microns`
7. **Additional refrigerant charge calculated for line length, weighed in, and recorded**  
    `Critical`
8. **Additional charge added**  
    `Measurement — oz`
9. **Both lines fully insulated with no gaps at fittings; outdoor insulation UV protected**  
    `Photo for record`
10. **Line set supported, protected where it passes through framing, and free of kinks**
11. **Exterior line hide installed neatly, sealed at the wall, and pitched to shed water**  
    `Photo for record`

### Electrical & Controls

1. **Breaker size and wire gauge match the equipment nameplate MCA and MOCP**  
    `Critical` · `Photo for record`
2. **Disconnect installed within sight of the unit and properly labeled**  
    `Critical`
3. **Whip and conduit secured, weatherproof, with correct fittings and drip loops**
4. **Equipment grounded and bonded per code**  
    `Critical`
5. **Communication wiring is the specified type and is not run in the same conduit as line voltage**  
    `Critical`  
    *Mixing control and line voltage is the number one cause of nuisance comm errors.*
6. **All terminations tight, correctly landed, and torqued; no exposed conductors**
7. **Thermostat or wall controller mounted at proper height, away from drafts and heat sources**
8. **Interface commissioned, connected to Wi-Fi, and app access handed to the customer**  
    `Photo for record`
9. **Dip switches and configuration settings set for this installation, not left at factory default**  
    `Critical` · `Photo for record`

### Air Handler & Distribution

1. **Air handler mounted level, isolated from structure, with full service access**
2. **Supply and return plenums sealed airtight to the cabinet**  
    `Photo for record`
3. **All duct joints mechanically fastened and sealed with mastic**
4. **Ducts in unconditioned space insulated to spec with sealed vapor barrier**
5. **Filter rack accessible, gasketed, and filter size labeled**  
    `Photo for record`
6. **Total external static pressure measured and within the blower table limits**  
    `Critical` · `Photo for record`
7. **Total external static pressure**  
    `Measurement — in. w.c.`
8. **Delivered airflow verified against design CFM; blower speed set accordingly**  
    `Critical`
9. **Registers and grilles installed, balanced, and every room gets measurable airflow**
10. **Primary drain trapped and sloped; secondary drain or float safety switch installed and tested**  
    `Critical` · `Photo for record`
11. **Condensate system flow tested with water and safety switch proven to shut the unit down**  
    `Critical`

### Startup & Performance

1. **System run in heating; discharge air temperature and operation verified**  
    `Critical`
2. **System run in cooling; discharge air temperature and operation verified**  
    `Critical`
3. **Supply / return delta-T**  
    `Measurement — °F`
4. **No fault codes present after a full run in both modes**  
    `Critical` · `Photo for record`
5. **Defrost operation explained to the customer so steam and noise are not alarming**
6. **Indoor and outdoor noise levels acceptable; no rattles, buzzing, or resonance**
7. **Backup or auxiliary heat lockout and staging configured correctly**  
    `Critical`  
    *A hyper-heat system that leans on strip heat at 35°F will destroy the operating cost promise.*
8. **Startup report completed, signed, and filed with the job**  
    `Photo for record`

---

## Mitsubishi Ductless Hyper-Heat Heat Pump

**Category:** Mitsubishi Ductless  
**Use for:** Wall-mounted, floor-mounted and ceiling cassette heads, single and multi-zone.  
**Size:** 6 system sections (61 items including the universal block)

> Runs after **Universal QC Standards**.

### Indoor Heads

1. **Head models, capacities, and locations match the design and proposal**  
    `Critical` · `Photo for record`
2. **Mounting plate anchored to studs or solid backing, not drywall anchors alone**  
    `Critical`
3. **Head is level side to side and pitched per manufacturer for drainage**  
    `Critical` · `Photo for record`  
    *A head that is out of level will weep condensate down the wall within a season.*
4. **Clearance from ceiling, side walls, and furniture meets manufacturer minimums**
5. **Head placement gives good throw into the room and is not blocked by drapes or cabinetry**
6. **Installation is neat and matches what the customer was shown during the sale**

### Wall Penetration & Condensate

1. **Wall penetration sleeved, sloped down to the exterior, and sealed inside and out**  
    `Critical` · `Photo for record`
2. **No structural framing cut or notched without approval**  
    `Critical`
3. **Condensate drain has continuous downward slope with no sags, traps, or upward runs**  
    `Critical` · `Photo for record`
4. **Every head drain flow tested by pouring water into the pan**  
    `Critical`
5. **Condensate line insulated where it runs through unconditioned or finished space**
6. **Condensate pump (where used) mounted, quiet, and wired to shut the unit down on high level**  
    `Critical`
7. **Condensate terminates where it will not stain siding, ice a walkway, or dump on a foundation**

### Line Sets & Refrigerant

1. **Total line length and height difference are within limits for this system**  
    `Critical`
2. **Flares cut, deburred, and torqued to specification with a torque wrench**  
    `Critical`
3. **No oil residue or bubbles at any flare or joint after leak check**  
    `Critical`
4. **Evacuated to 500 microns or below with a documented decay test**  
    `Critical` · `Photo for record`
5. **Final micron reading after decay test**  
    `Measurement — microns`
6. **Additional charge calculated and weighed in where line length requires it**
7. **Both lines individually insulated end to end with sealed seams**  
    `Photo for record`
8. **Line hide runs straight and level, sealed at penetrations, painted where specified**  
    `Photo for record`
9. **Line set protected from lawn equipment, foot traffic, and snow removal damage**

### Multi-Zone & Branch Box

*Skip with N/A on single-zone systems.*

1. **Branch box mounted level, accessible for service, and in a serviceable location**
2. **Branch box condensate drain installed and tested where the model requires one**
3. **Every port labeled with the room it serves and matched to the as-built drawing**  
    `Critical` · `Photo for record`
4. **Zone mapping physically verified by running each head one at a time**  
    `Critical`
5. **Unused branch box ports capped and configured per manufacturer**

### Outdoor Unit & Electrical

1. **Outdoor unit level and elevated above snow line on pad, stand, or wall bracket**  
    `Critical` · `Photo for record`
2. **Airflow and service clearances met; not boxed in by fencing or plantings**
3. **Defrost meltwater drains clear of the unit and any walkway**  
    `Critical`
4. **Breaker and wire sized to the nameplate MCA and MOCP**  
    `Critical` · `Photo for record`
5. **Disconnect within sight, labeled, and weatherproof**  
    `Critical`
6. **Control wiring is the specified type, correctly landed per zone, and separated from line voltage**  
    `Critical`
7. **Equipment grounded and bonded per code**  
    `Critical`

### Startup & Customer Handoff

1. **Every head run in heating and confirmed delivering warm air**  
    `Critical`
2. **Every head run in cooling and confirmed delivering cold air**  
    `Critical`
3. **Delta-T at each head (list per room)**  
    `Measurement — °F`
4. **Heads run 15+ minutes in cooling and checked for drips at pan and wall**  
    `Critical`
5. **No fault codes on any indoor or outdoor unit after full operation**  
    `Critical` · `Photo for record`
6. **Remotes or wall controllers paired, batteries installed, and labeled by room**  
    `Photo for record`
7. **Wi-Fi interface commissioned and app access transferred to the customer**
8. **Filters clean and seated; customer shown how to remove and wash them**
9. **Customer coached on set-and-forget operation and why not to use it like a window unit**  
    *Single biggest driver of customer dissatisfaction and high bills on ductless.*

---

## Quilt Ductless Heat Pump

**Category:** Quilt  
**Use for:** Quilt indoor Covers, Dial controllers, outdoor unit and app commissioning.  
**Size:** 6 system sections (66 items including the universal block)

> Runs after **Universal QC Standards**.

### System Design Verification

1. **Installed configuration matches the approved Quilt system design and proposal**  
    `Critical` · `Photo for record`
2. **Correct number of indoor Covers installed in the correct rooms**  
    `Critical`
3. **Capacity matches the room-by-room load calculation**  
    `Critical`
4. **Serial numbers of the outdoor unit, each Cover, and each Dial recorded**  
    `Photo for record`

### Indoor Covers

1. **Mounting bracket anchored into studs or approved solid backing**  
    `Critical`
2. **Cover is level and set at the manufacturer-specified height and clearances**  
    `Critical` · `Photo for record`
3. **Clearance to ceiling, corners, and furnishings meets Quilt requirements**
4. **Airflow path into the room is unobstructed by drapery, shelving, or trim**
5. **Cover seated fully with no gaps, scuffs, protective film removed, and wall finish undamaged**  
    `Photo for record`
6. **Final placement was confirmed with the customer before drilling**

### Penetrations, Line Sets & Condensate

1. **Wall penetration sleeved, pitched to the exterior, and sealed weather-tight both sides**  
    `Critical` · `Photo for record`
2. **Line set size and length are within Quilt specification for this pairing**  
    `Critical`
3. **Flares cut, deburred, and torqued to Quilt specification with a torque wrench**  
    `Critical`
4. **Nitrogen purge used during brazing where brazing was required**  
    `Critical`
5. **Evacuated to 500 microns or below with a documented decay test**  
    `Critical` · `Photo for record`
6. **Final micron reading after decay test**  
    `Measurement — microns`
7. **Leak check performed at every joint with no bubbles or oil residue**  
    `Critical`
8. **Additional charge calculated for line length, weighed in, and recorded**
9. **Lines fully insulated with sealed seams; UV-rated protection outdoors**  
    `Photo for record`
10. **Line covers run straight, sealed at penetrations, and finished to the agreed appearance**  
    `Photo for record`
11. **Condensate drain has continuous fall with no sags or traps**  
    `Critical`
12. **Condensate flow tested with water at every Cover**  
    `Critical`
13. **Condensate terminates clear of walkways, siding, and the foundation**

### Outdoor Unit & Electrical

1. **Outdoor unit level and elevated above snow and flood level per Quilt guidance**  
    `Critical` · `Photo for record`
2. **Required airflow and service clearances met on all sides**
3. **Vibration isolation installed and unit secured against wind and snow load**
4. **Defrost meltwater drains away and will not ice a walkway or door path**  
    `Critical`
5. **Circuit, breaker, and conductor sizing match the Quilt nameplate requirements**  
    `Critical` · `Photo for record`
6. **Disconnect within sight of the unit, labeled, and weatherproof**  
    `Critical`
7. **Equipment grounded and bonded per code**  
    `Critical`
8. **Communication and power wiring landed per Quilt documentation and separated as required**  
    `Critical`

### Dial Controllers

1. **Each Dial mounted at the specified height, level, and securely fastened**
2. **Dial located away from direct sun, supply air, and heat-producing appliances**  
    `Critical`  
    *A Dial reading a false room temperature will make the system look broken.*
3. **Each Dial paired to the correct Cover and responds to input**  
    `Critical`
4. **Rooms named correctly in the system so the customer sees the names they expect**

### App Commissioning & Handoff

1. **System connected to the home Wi-Fi with a stable signal at the outdoor unit**  
    `Critical` · `Photo for record`
2. **Home set up in the Quilt app with correct address, rooms, and zone names**  
    `Critical`
3. **Firmware updated to current release and system reports healthy**  
    `Photo for record`
4. **Account ownership transferred to the homeowner and their login confirmed working**  
    `Critical`  
    *Do not leave the system under an installer account.*
5. **Every zone run in heating and confirmed delivering warm air**  
    `Critical`
6. **Every zone run in cooling and confirmed delivering cold air**  
    `Critical`
7. **Delta-T at each Cover (list per room)**  
    `Measurement — °F`
8. **Covers run 15+ minutes in cooling and checked for condensate drips**  
    `Critical`
9. **No alerts or faults shown in the app after full operation**  
    `Critical` · `Photo for record`
10. **Operating noise acceptable indoors and out; no rattles or resonance**
11. **Customer walked through the app: scheduling, zone control, and away mode**
12. **Customer shown how to remove and clean the Cover filters**
13. **Customer told how Quilt support and our service line divide responsibility**
