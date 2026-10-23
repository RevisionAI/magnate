using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Rules;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Market;

/// <summary>One building's monthly fixed costs under Realistic rules (econ-audit §4.5–4.6).</summary>
/// <param name="Headcount">Committed staff.</param>
/// <param name="Wages">Wages: headcount × base wage(role) × city wage index.</param>
/// <param name="Utilities">Fixed opex (base-load power, security, cleaning, supplies): the content's level-aware monthly operating cost.</param>
/// <param name="Maintenance">1.5 %/yr of structure cost + 4 %/yr of installed equipment.</param>
/// <param name="Insurance">0.3 %/yr of gross PP&amp;E.</param>
/// <param name="PropertyTax">1.2 %/yr (farms 0.6 %) of land cost + net book value.</param>
/// <param name="Operational">False while under construction (only insurance and property tax are due).</param>
public sealed record BuildingCosts(
    double Headcount,
    decimal Wages,
    decimal Utilities,
    decimal Maintenance,
    decimal Insurance,
    decimal PropertyTax,
    bool Operational)
{
    /// <summary>Every cost line together.</summary>
    public decimal Total => Wages + Utilities + Maintenance + Insurance + PropertyTax;
}

/// <summary>
/// Payroll and overhead (econ-audit §4.5–4.6):
/// <code>
/// Headcount = Fixed · LevelStaffMult(level) + Σ active slots · StaffPerSlot
/// Wages     = Σ_role headcount_role · BaseWage(role) · WageIndex_city
/// </code>
/// "Active" means configured: idle but configured slots still pay staff, which is what makes idle
/// capacity cost something. Production slots staff from <see cref="Recipe.LaborPerSlot"/>,
/// extraction slots from <see cref="ProductExtraction.LaborPerSlot"/>, retail/warehouse/research
/// slots from <see cref="BuildingStaffing.PerSlot"/>.
/// </summary>
public static class OperatingCosts
{
    /// <summary>Base monthly wage of a role under <paramref name="rules"/>.</summary>
    public static decimal Wage(MarketRules rules, string role) => role switch
    {
        StaffRoles.Production => rules.WageProduction,
        StaffRoles.Retail => rules.WageRetail,
        StaffRoles.Farm => rules.WageFarm,
        StaffRoles.Extraction => rules.WageExtraction,
        StaffRoles.Admin => rules.WageAdmin,
        StaffRoles.Scientist => rules.WageScientist,
        StaffRoles.Media => rules.WageMedia,
        _ => rules.WageAdmin,
    };

    /// <summary>Fixed-staff multiplier of a level (L1 1.00, L2 1.25, L3+ 1.50).</summary>
    public static double LevelStaffMultiplier(MarketRules rules, int level) => level switch
    {
        <= 1 => 1.0,
        2 => rules.Level2StaffMultiplier,
        _ => rules.Level3StaffMultiplier,
    };

    /// <summary>Headcount by wage role, roles in <see cref="StaffRoles.All"/> order.</summary>
    public static IReadOnlyList<(string Role, double Staff)> Staff(World world, BuildingInstance building)
    {
        var type = world.Catalog.BuildingType(building.TypeId);
        var staffing = type.Staffing;
        var rules = world.Rules.Market;
        var byRole = new Dictionary<string, double>(StringComparer.Ordinal);

        void Add(string role, double staff)
        {
            if (staff <= 0) return;
            byRole[role] = byRole.TryGetValue(role, out var v) ? v + staff : staff;
        }

        Add(staffing.FixedRole, staffing.Fixed * LevelStaffMultiplier(rules, building.Level));
        foreach (var slot in building.ProductionSlots.OrderBy(s => s.Index))
        {
            Add(StaffRoles.Production, world.Catalog.Product(slot.Product).Recipe?.LaborPerSlot ?? 0);
        }

        foreach (var slot in building.ExtractionSlots.OrderBy(s => s.Index))
        {
            Add(staffing.SlotRole, world.Catalog.Product(slot.Product).Extraction?.LaborPerSlot ?? 0);
        }

        var otherSlots = building.RetailSlots.Count + building.WarehouseSlots.Count + building.ResearchSlots.Count;
        Add(staffing.SlotRole, staffing.PerSlot * otherSlots);

        return StaffRoles.All.Where(byRole.ContainsKey).Select(r => (r, byRole[r])).ToList();
    }

    /// <summary>The building's monthly fixed costs.</summary>
    public static BuildingCosts Of(World world, BuildingInstance building)
    {
        var rules = world.Rules.Market;
        var type = world.Catalog.BuildingType(building.TypeId);
        var city = world.Catalog.City(building.City);
        var operational = world.SiteInfo.IsOperational(building);

        double headcount = 0;
        decimal wages = 0m;
        decimal utilities = 0m;
        decimal maintenance = 0m;
        if (operational)
        {
            var wageIndex = (decimal)city.WageIndex;
            foreach (var (role, staff) in Staff(world, building))
            {
                headcount += staff;
                wages += Wage(rules, role) * (decimal)staff * wageIndex;
            }

            utilities = world.GetMonthlyOpex(building);
            var equipment = world.MarketState.InstalledEquipmentCost(building.Id);
            var structure = Math.Max(0m, building.CapitalizedCost - equipment);
            maintenance = (structure * rules.MaintenanceStructureRate + equipment * rules.MaintenanceEquipmentRate) / 12m;
        }

        var insurance = building.CapitalizedCost * rules.InsuranceRate / 12m;
        var taxRate = type.Category is "farm" or "plantation" ? rules.AgriculturalPropertyTaxRate : rules.PropertyTaxRate;
        var propertyTax = (world.SiteInfo.LandCost(building) + building.BookValue) * taxRate / 12m;

        return new BuildingCosts(headcount, wages, utilities, maintenance, insurance, propertyTax, operational);
    }

    /// <summary>Σ monthly fixed costs of every building a company owns (the cash-reserve base).</summary>
    public static decimal CompanyMonthly(World world, CompanyId company)
    {
        decimal total = 0m;
        foreach (var building in world.Buildings.Values.Where(b => b.Owner == company).OrderBy(b => b.Id.Value))
        {
            total += Of(world, building).Total;
        }

        return total;
    }
}
