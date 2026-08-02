export const renderSymbolInstance = ({
  libraryId,
  reference,
  value,
  footprint,
  description,
  x,
  y,
  pins,
  symbolUuid,
  instancePath,
}: {
  libraryId: string;
  reference: string;
  value: string;
  footprint: string;
  description: string;
  x: number;
  y: number;
  pins: string[];
  symbolUuid: string;
  instancePath: string;
}): string => {
  const pinLines = pins
    .map(
      (pin, index) =>
        `\t\t(pin "${pin}"\n\t\t\t(uuid "00000000-0000-0000-0000-${symbolUuid.slice(-10)}${String(index + 1).padStart(2, "0")}")\n\t\t)`,
    )
    .join("\n");
  return `\t(symbol
		(lib_id "${libraryId}")
		(at ${x} ${y} 0)
		(unit 1)
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(dnp no)
		(uuid "${symbolUuid}")
		(property "Reference" "${reference}"
			(at ${x} ${y - 5} 0)
			(effects (font (size 1.27 1.27)))
		)
		(property "Value" "${value}"
			(at ${x} ${y + 5} 0)
			(effects (font (size 1.27 1.27)))
		)
		(property "Footprint" "${footprint}"
			(at ${x} ${y} 0)
			(effects (font (size 1.27 1.27)) (hide yes))
		)
		(property "Datasheet" "~"
			(at ${x} ${y} 0)
			(effects (font (size 1.27 1.27)) (hide yes))
		)
		(property "Description" "${description}"
			(at ${x} ${y} 0)
			(effects (font (size 1.27 1.27)) (hide yes))
		)
${pinLines}
		(instances
			(project "design"
				(path "${instancePath}"
					(reference "${reference}")
					(unit 1)
				)
			)
		)
	)`;
};

export const renderLabel = (
  name: string,
  x: number,
  y: number,
  id: string,
): string => `	(label "${name}"
		(at ${x} ${y} 0)
		(effects
			(font (size 1.27 1.27))
			(justify left bottom)
		)
		(uuid "${id}")
	)`;

export const deterministicUuid = (prefix: string, index: number): string =>
  `00000000-0000-4000-8000-${prefix}${String(index).padStart(12 - prefix.length, "0")}`;
