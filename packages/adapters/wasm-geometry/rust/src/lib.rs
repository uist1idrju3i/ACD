#![deny(unsafe_op_in_unsafe_fn)]

pub const MODULE_VERSION: &str = "0.1.0";

/// Returns squared distance between two axis-aligned rectangles in nanometres.
/// The boundary is integer-only and deliberately independent of any EDA engine.
#[allow(clippy::too_many_arguments)]
pub fn rectangle_distance_squared(
    a_left: i64,
    a_top: i64,
    a_right: i64,
    a_bottom: i64,
    b_left: i64,
    b_top: i64,
    b_right: i64,
    b_bottom: i64,
) -> i128 {
    let dx = if a_right < b_left {
        b_left - a_right
    } else if b_right < a_left {
        a_left - b_right
    } else {
        0
    };
    let dy = if a_bottom < b_top {
        b_top - a_bottom
    } else if b_bottom < a_top {
        a_top - b_bottom
    } else {
        0
    };
    let dx = i128::from(dx);
    let dy = i128::from(dy);
    dx * dx + dy * dy
}

#[no_mangle]
pub extern "C" fn acd_rectangle_distance_squared(
    a_left: i64,
    a_top: i64,
    a_right: i64,
    a_bottom: i64,
    b_left: i64,
    b_top: i64,
    b_right: i64,
    b_bottom: i64,
) -> i64 {
    rectangle_distance_squared(
        a_left, a_top, a_right, a_bottom, b_left, b_top, b_right, b_bottom,
    ) as i64
}

#[cfg(test)]
mod tests {
    use super::rectangle_distance_squared;

    #[test]
    fn exact_boundary_is_not_below_threshold() {
        assert_eq!(
            rectangle_distance_squared(0, 0, 1000, 1000, 2000, 0, 3000, 1000),
            1_000_000
        );
    }

    #[test]
    fn one_nanometre_breach_is_integer_detectable() {
        let distance = rectangle_distance_squared(0, 0, 1000, 1000, 2000, 0, 3000, 1000);
        assert!(distance < 1_001_i128 * 1_001_i128);
    }
}
