--========================================================================================================================
-- Local Cheat Panel — runtime localized text
--========================================================================================================================
		INSERT OR REPLACE INTO LocalizedText
			(Tag,	Language,	Text)
		VALUES
			('LOC_LCP_CHEAT_PANEL_OPEN_PANEL',		'en_US',	"Open ALL MIGHTY SAM'S POWERS"),
			('LOC_LCP_CHEAT_PANEL_HEADER',			'en_US',	"ALL MIGHTY SAM'S POWERS"),

			-- Tabs
			('LOC_LCP_CHEAT_TAB_PLAYER',			'en_US',	"Player"),
			('LOC_LCP_CHEAT_TAB_UNITS',				'en_US',	"Units"),
			('LOC_LCP_CHEAT_TAB_CITIES',			'en_US',	"Cities"),
			('LOC_LCP_CHEAT_TAB_MAP',				'en_US',	"Map"),
			('LOC_LCP_CHEAT_TAB_CREATIVE',			'en_US',	"Creative"),
			('LOC_LCP_CHEAT_TAB_RESEARCH',			'en_US',	"Research"),

			-- Section dividers
			('LOC_LCP_CHEAT_SECTION_BULK',			'en_US',	"── Bulk Actions ──"),

			-- Player tab
			('LOC_LCP_CHEAT_BTN_ADD_GOLD',			'en_US',	"[icon:YIELD_GOLD] Add Gold"),
			('LOC_LCP_CHEAT_GOLD_1',				'en_US',	"[icon:YIELD_GOLD] +10,000"),
			('LOC_LCP_CHEAT_GOLD_2',				'en_US',	"[icon:YIELD_GOLD] +100,000"),
			('LOC_LCP_CHEAT_GOLD_3',				'en_US',	"[icon:YIELD_GOLD] +1,000,000"),
			('LOC_LCP_CHEAT_BTN_ADD_INFLUENCE',		'en_US',	"[icon:YIELD_DIPLOMACY] Add Influence"),
			('LOC_LCP_CHEAT_BTN_ADD_ATTR',			'en_US',	"Add Wildcard Attribute Points"),

			-- Units tab
			('LOC_LCP_CHEAT_BTN_RESTORE_MOVE_SEL',	'en_US',	"[icon:UNIT_MOVEMENT_ICON] Restore Movement (Selected)"),
			('LOC_LCP_CHEAT_BTN_HEAL_SEL',			'en_US',	"Heal Selected Unit"),
			('LOC_LCP_CHEAT_BTN_GIVE_EXP',			'en_US',	"Give Experience"),
			('LOC_LCP_CHEAT_BTN_DUP_SEL',			'en_US',	"Duplicate Selected Unit"),
			('LOC_LCP_CHEAT_BTN_RESTORE_MOVE_ALL',	'en_US',	"[icon:UNIT_MOVEMENT_ICON] Restore Movement (All Units)"),
			('LOC_LCP_CHEAT_BTN_HEAL_ALL',			'en_US',	"Heal All My Units"),
			('LOC_LCP_CHEAT_SECTION_UNIT_LIST',		'en_US',	"── All Units ──"),
			('LOC_LCP_CHEAT_BTN_REFRESH',			'en_US',	"Refresh"),
			('LOC_LCP_CHEAT_CONFIRM_DELETE_UNIT',	'en_US',	"Delete (disband) this unit? This cannot be undone."),

			-- Cities tab
			('LOC_LCP_CHEAT_BTN_COMPLETE_PROD_SEL',	'en_US',	"[icon:YIELD_PRODUCTION] Complete Production (Selected)"),
			('LOC_LCP_CHEAT_BTN_ADD_POP_SEL',		'en_US',	"Add Population (Selected)"),
			('LOC_LCP_CHEAT_BTN_COMPLETE_PROD_ALL',	'en_US',	"[icon:YIELD_PRODUCTION] Complete Production (All Cities)"),
			('LOC_LCP_CHEAT_BTN_ADD_POP_ALL',		'en_US',	"Add Population (All Cities)"),
			('LOC_LCP_CHEAT_SECTION_CITY_LIST',		'en_US',	"── All Cities ──"),

			-- Research tab
			('LOC_LCP_CHEAT_BTN_COMPLETE_RESEARCH',	'en_US',	"[icon:YIELD_SCIENCE] Complete Current Research"),
			('LOC_LCP_CHEAT_BTN_COMPLETE_CIVIC',	'en_US',	"[icon:YIELD_CULTURE] Complete Current Civic"),

			-- Confirmation dialog bodies (for bulk / destructive cheats)
			('LOC_LCP_CHEAT_CONFIRM_MOVE_ALL',		'en_US',	"Restore movement points for every unit in your empire?"),
			('LOC_LCP_CHEAT_CONFIRM_HEAL_ALL',		'en_US',	"Heal every unit in your empire to full health?"),
			('LOC_LCP_CHEAT_CONFIRM_PROD_ALL',		'en_US',	"Complete the current production in every city you control?"),
			('LOC_LCP_CHEAT_CONFIRM_POP_ALL',		'en_US',	"Add population to every city you control?");
--========================================================================================================================
--========================================================================================================================
