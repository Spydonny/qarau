use sha2::{Digest, Sha256};

pub const DATASET_ID_DOMAIN: &[u8] = b"QARAU_DATASET_ID_V1\0";
pub const ACCESS_POLICY_DOMAIN: &[u8] = b"QARAU_ACCESS_POLICY_V1\0";

pub const REGISTRY_SPACE: usize = 76;
pub const DATASET_COMMITMENT_SPACE: usize = 271;
pub const SALE_SPACE: usize = 156;
pub const ACCESS_GRANT_SPACE: usize = 159;

pub fn domain_hash(domain: &[u8], bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    hasher.finalize().into()
}

pub fn uuid_bytes(value: &str) -> Result<[u8; 16], &'static str> {
    let compact: String = value.chars().filter(|character| *character != '-').collect();
    if compact.len() != 32 || !compact.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("invalid_uuid");
    }

    let mut output = [0_u8; 16];
    for (index, byte) in output.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&compact[index * 2..index * 2 + 2], 16)
            .map_err(|_| "invalid_uuid")?;
    }
    Ok(output)
}

pub fn dataset_id_hash(uuid: &str) -> Result<[u8; 32], &'static str> {
    Ok(domain_hash(DATASET_ID_DOMAIN, &uuid_bytes(uuid)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ACCESS_POLICY_CANONICAL: &str = "{\"allowed_tier_mask\":3,\"delayed\":{\"release_seconds\":\"604800\",\"version_lag\":1},\"early\":{\"available_immediately\":true},\"expiry\":{\"grant_duration_seconds\":\"2592000\"},\"grant_scope\":\"PURCHASED_DATASET_LINE\",\"policy_version\":1}";

    #[test]
    fn matches_node_access_policy_hash_fixture() {
        assert_eq!(
            domain_hash(ACCESS_POLICY_DOMAIN, ACCESS_POLICY_CANONICAL.as_bytes()),
            [95, 80, 129, 208, 156, 166, 50, 81, 227, 237, 92, 143, 228, 102, 235, 241, 20, 0, 20, 63, 51, 114, 191, 42, 23, 138, 147, 2, 15, 116, 111, 206]
        );
    }

    #[test]
    fn matches_node_dataset_id_hash_fixture() {
        assert_eq!(
            dataset_id_hash("018f5c52-4b2e-7ad1-8f7c-222222222222").unwrap(),
            [33, 109, 220, 0, 150, 104, 3, 171, 139, 73, 199, 90, 133, 4, 215, 158, 86, 113, 79, 130, 223, 64, 91, 80, 31, 212, 184, 107, 134, 150, 59, 155]
        );
    }

    #[test]
    fn frozen_account_spaces_include_anchor_discriminators() {
        assert_eq!(REGISTRY_SPACE, 8 + 32 + 32 + 2 + 1 + 1);
        assert_eq!(DATASET_COMMITMENT_SPACE, 8 + 32 + 4 + (32 * 5) + 32 + 8 + 4 + 1 + 4 + 8 + 8 + 1 + 1);
        assert_eq!(SALE_SPACE, 8 + 32 + 32 + 8 + 8 + 1 + 8 + 8 + 8 + 32 + 4 + 4 + 1 + 1 + 1);
        assert_eq!(ACCESS_GRANT_SPACE, 8 + 32 + 32 + 32 + 32 + 4 + 1 + 8 + 8 + 1 + 1);
    }
}
