#![deny(unsafe_op_in_unsafe_fn)]

pub const MODULE_VERSION: &str = "0.1.0";

const MAGIC_INPUT: i64 = 0xACD7_0001;
const MAGIC_OUTPUT: i64 = 0xACD7_0002;
const UNKNOWN: i64 = 0;
const PASSED: i64 = 1;
const FAILED: i64 = 2;
const MAX_POINTS: usize = 1_000_000;

#[derive(Clone, Copy)]
struct Point {
    x: i64,
    y: i64,
}

struct Polygon {
    points: Vec<Point>,
}

struct Pad {
    polygon: Polygon,
    expansion: i64,
}

struct Finding {
    left: i64,
    right: i64,
    measured: i64,
    threshold: i64,
}

fn read_i64(input: &[u8], cursor: &mut usize) -> Option<i64> {
    let end = cursor.checked_add(8)?;
    let bytes = input.get(*cursor..end)?;
    *cursor = end;
    Some(i64::from_le_bytes(bytes.try_into().ok()?))
}

fn write_i64(output: &mut [u8], cursor: &mut usize, value: i64) -> bool {
    let end = match cursor.checked_add(8) {
        Some(value) => value,
        None => return false,
    };
    let Some(bytes) = output.get_mut(*cursor..end) else {
        return false;
    };
    bytes.copy_from_slice(&value.to_le_bytes());
    *cursor = end;
    true
}

fn cross(a: Point, b: Point, c: Point) -> i128 {
    i128::from(b.x - a.x) * i128::from(c.y - a.y) - i128::from(b.y - a.y) * i128::from(c.x - a.x)
}

fn between(a: Point, b: Point, c: Point) -> bool {
    c.x >= a.x.min(b.x) && c.x <= a.x.max(b.x) && c.y >= a.y.min(b.y) && c.y <= a.y.max(b.y)
}

fn segments_intersect(a: Point, b: Point, c: Point, d: Point) -> bool {
    let ab_c = cross(a, b, c);
    let ab_d = cross(a, b, d);
    let cd_a = cross(c, d, a);
    let cd_b = cross(c, d, b);
    if ((ab_c > 0 && ab_d < 0) || (ab_c < 0 && ab_d > 0))
        && ((cd_a > 0 && cd_b < 0) || (cd_a < 0 && cd_b > 0))
    {
        return true;
    }
    (ab_c == 0 && between(a, b, c))
        || (ab_d == 0 && between(a, b, d))
        || (cd_a == 0 && between(c, d, a))
        || (cd_b == 0 && between(c, d, b))
}

fn inside(point: Point, polygon: &Polygon) -> bool {
    let mut winding = false;
    for index in 0..polygon.points.len() {
        let a = polygon.points[index];
        let b = polygon.points[(index + 1) % polygon.points.len()];
        if (a.y > point.y) != (b.y > point.y) {
            let lhs = i128::from(point.x - a.x) * i128::from(b.y - a.y);
            let rhs = i128::from(b.x - a.x) * i128::from(point.y - a.y);
            if (b.y > a.y) == (lhs < rhs) {
                winding = !winding;
            }
        }
    }
    winding
}

fn squared_distance(a: Point, b: Point) -> i128 {
    let dx = i128::from(a.x) - i128::from(b.x);
    let dy = i128::from(a.y) - i128::from(b.y);
    dx * dx + dy * dy
}

fn point_segment_distance_squared(point: Point, a: Point, b: Point) -> i128 {
    let dx = i128::from(b.x) - i128::from(a.x);
    let dy = i128::from(b.y) - i128::from(a.y);
    let px = i128::from(point.x) - i128::from(a.x);
    let py = i128::from(point.y) - i128::from(a.y);
    let length = dx * dx + dy * dy;
    if length == 0 {
        return squared_distance(point, a);
    }
    let dot = px * dx + py * dy;
    if dot <= 0 {
        return squared_distance(point, a);
    }
    if dot >= length {
        return squared_distance(point, b);
    }
    let area = px * dy - py * dx;
    (area * area) / length
}

fn polygon_distance_squared(a: &Polygon, b: &Polygon) -> i128 {
    if a.points.iter().any(|point| inside(*point, b))
        || b.points.iter().any(|point| inside(*point, a))
    {
        return 0;
    }
    let mut best: Option<i128> = None;
    for ai in 0..a.points.len() {
        let a1 = a.points[ai];
        let a2 = a.points[(ai + 1) % a.points.len()];
        for bi in 0..b.points.len() {
            let b1 = b.points[bi];
            let b2 = b.points[(bi + 1) % b.points.len()];
            if segments_intersect(a1, a2, b1, b2) {
                return 0;
            }
            for point in [a1, a2] {
                let candidate = point_segment_distance_squared(point, b1, b2);
                best = Some(best.map_or(candidate, |value| value.min(candidate)));
            }
            for point in [b1, b2] {
                let candidate = point_segment_distance_squared(point, a1, a2);
                best = Some(best.map_or(candidate, |value| value.min(candidate)));
            }
        }
    }
    best.unwrap_or(0)
}

fn integer_sqrt(value: i128) -> i64 {
    if value <= 0 {
        return 0;
    }
    let mut low = 1_i128;
    let mut high = value;
    while low <= high {
        let middle = (low + high) / 2;
        if middle * middle <= value {
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    high as i64
}

fn expand(polygon: &Polygon, expansion: i64) -> Polygon {
    let left = polygon.points.iter().map(|point| point.x).min().unwrap() - expansion;
    let right = polygon.points.iter().map(|point| point.x).max().unwrap() + expansion;
    let top = polygon.points.iter().map(|point| point.y).min().unwrap() - expansion;
    let bottom = polygon.points.iter().map(|point| point.y).max().unwrap() + expansion;
    Polygon {
        points: vec![
            Point { x: left, y: top },
            Point { x: right, y: top },
            Point {
                x: right,
                y: bottom,
            },
            Point { x: left, y: bottom },
        ],
    }
}

fn read_polygon(input: &[u8], cursor: &mut usize) -> Option<Polygon> {
    let count = usize::try_from(read_i64(input, cursor)?).ok()?;
    if !(3..=MAX_POINTS).contains(&count) {
        return None;
    }
    let mut points = Vec::with_capacity(count);
    for _ in 0..count {
        points.push(Point {
            x: read_i64(input, cursor)?,
            y: read_i64(input, cursor)?,
        });
    }
    Some(Polygon { points })
}

fn read_input(input: &[u8]) -> Option<(Vec<Pad>, Vec<Polygon>, [i64; 3])> {
    let mut cursor = 0;
    if read_i64(input, &mut cursor)? != MAGIC_INPUT {
        return None;
    }
    let pad_count = usize::try_from(read_i64(input, &mut cursor)?).ok()?;
    let courtyard_count = usize::try_from(read_i64(input, &mut cursor)?).ok()?;
    if pad_count > MAX_POINTS || courtyard_count > MAX_POINTS {
        return None;
    }
    let thresholds = [
        read_i64(input, &mut cursor)?,
        read_i64(input, &mut cursor)?,
        read_i64(input, &mut cursor)?,
    ];
    let mut pads = Vec::with_capacity(pad_count);
    for _ in 0..pad_count {
        pads.push(Pad {
            polygon: read_polygon(input, &mut cursor)?,
            expansion: read_i64(input, &mut cursor)?,
        });
    }
    let mut courtyards = Vec::with_capacity(courtyard_count);
    for _ in 0..courtyard_count {
        courtyards.push(read_polygon(input, &mut cursor)?);
    }
    if cursor != input.len() {
        return None;
    }
    Some((pads, courtyards, thresholds))
}

fn rule(threshold: i64, available: bool, pairs: Vec<Finding>) -> (i64, Vec<Finding>) {
    if threshold < 0 || !available {
        return (UNKNOWN, Vec::new());
    }
    (if pairs.is_empty() { PASSED } else { FAILED }, pairs)
}

fn run(input: &[u8], output: &mut [u8]) -> Option<usize> {
    let (pads, courtyards, thresholds) = read_input(input)?;
    let mut pad_pairs = Vec::new();
    let mut mask_pairs = Vec::new();
    for left in 0..pads.len() {
        for right in (left + 1)..pads.len() {
            let distance = polygon_distance_squared(&pads[left].polygon, &pads[right].polygon);
            if thresholds[0] >= 0 && distance < i128::from(thresholds[0]).pow(2) {
                pad_pairs.push(Finding {
                    left: left as i64,
                    right: right as i64,
                    measured: integer_sqrt(distance),
                    threshold: thresholds[0],
                });
            }
            if pads[left].expansion >= 0 && pads[right].expansion >= 0 {
                let a = expand(&pads[left].polygon, pads[left].expansion);
                let b = expand(&pads[right].polygon, pads[right].expansion);
                let distance = polygon_distance_squared(&a, &b);
                if thresholds[1] >= 0 && distance < i128::from(thresholds[1]).pow(2) {
                    mask_pairs.push(Finding {
                        left: left as i64,
                        right: right as i64,
                        measured: integer_sqrt(distance),
                        threshold: thresholds[1],
                    });
                }
            }
        }
    }
    let mut courtyard_pairs = Vec::new();
    for left in 0..courtyards.len() {
        for right in (left + 1)..courtyards.len() {
            let distance = polygon_distance_squared(&courtyards[left], &courtyards[right]);
            if thresholds[2] >= 0 && distance < i128::from(thresholds[2]).pow(2) {
                courtyard_pairs.push(Finding {
                    left: left as i64,
                    right: right as i64,
                    measured: integer_sqrt(distance),
                    threshold: thresholds[2],
                });
            }
        }
    }
    let (pad_status, pad_findings) = rule(thresholds[0], pads.len() > 1, pad_pairs);
    let (mask_status, mask_findings) = rule(
        thresholds[1],
        pads.len() > 1 && pads.iter().all(|pad| pad.expansion >= 0),
        mask_pairs,
    );
    let (courtyard_status, courtyard_findings) =
        rule(thresholds[2], courtyards.len() > 1, courtyard_pairs);
    let sections = [
        (pad_status, pad_findings),
        (mask_status, mask_findings),
        (courtyard_status, courtyard_findings),
    ];
    let mut cursor = 0;
    if !write_i64(output, &mut cursor, MAGIC_OUTPUT) {
        return None;
    }
    for (status, findings) in sections {
        if !write_i64(output, &mut cursor, status)
            || !write_i64(output, &mut cursor, findings.len() as i64)
        {
            return None;
        }
        for finding in findings {
            if !write_i64(output, &mut cursor, finding.left)
                || !write_i64(output, &mut cursor, finding.right)
                || !write_i64(output, &mut cursor, finding.measured)
                || !write_i64(output, &mut cursor, finding.threshold)
            {
                return None;
            }
        }
    }
    Some(cursor)
}

#[no_mangle]
pub extern "C" fn acd_geometry_run(
    input_ptr: i32,
    input_len: i32,
    output_ptr: i32,
    output_capacity: i32,
) -> i32 {
    if input_ptr < 0 || input_len < 0 || output_ptr < 0 || output_capacity < 0 {
        return -1;
    }
    let input = unsafe { std::slice::from_raw_parts(input_ptr as *const u8, input_len as usize) };
    let output =
        unsafe { std::slice::from_raw_parts_mut(output_ptr as *mut u8, output_capacity as usize) };
    match run(input, output) {
        Some(length) => length as i32,
        None => -2,
    }
}

#[cfg(test)]
mod tests {
    use super::polygon_distance_squared;
    use super::{Point, Polygon};

    fn rectangle(left: i64, top: i64, right: i64, bottom: i64) -> Polygon {
        Polygon {
            points: vec![
                Point { x: left, y: top },
                Point { x: right, y: top },
                Point {
                    x: right,
                    y: bottom,
                },
                Point { x: left, y: bottom },
            ],
        }
    }

    #[test]
    fn exact_boundary_is_not_below_threshold() {
        assert_eq!(
            polygon_distance_squared(
                &rectangle(0, 0, 1000, 1000),
                &rectangle(2000, 0, 3000, 1000)
            ),
            1_000_000
        );
    }

    #[test]
    fn one_nanometre_breach_is_integer_detectable() {
        let distance = polygon_distance_squared(
            &rectangle(0, 0, 1000, 1000),
            &rectangle(1999, 0, 2999, 1000),
        );
        assert!(distance < 1_000_i128 * 1_000_i128);
    }
}
