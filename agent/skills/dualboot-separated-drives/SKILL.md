---
name: "dualboot-separated-drives"
description: "Plan or execute boot/EFI recovery for Pandaking's fully separated Windows and Ubuntu drives, each with its own ESP. Use only for explicit bootloader, ESP, GRUB, initramfs, efibootmgr, or partition work; never for ordinary OS troubleshooting."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: critical
disable-model-invocation: true
---
## When to Use
Load manually before any `efibootmgr`, `grub-install`, ESP, initramfs, os-prober, or partition operation on Pandaking. Do not use remembered device names or UUIDs. Explicit user approval and freshly observed device evidence are mandatory.

## Procedure
1. Re-read current `lsblk -o NAME,SIZE,FSTYPE,UUID,PARTUUID,PARTLABEL,MOUNTPOINT`, `blkid`, `findmnt /boot/efi`, and `efibootmgr -v` output immediately before proposing a mutation.
2. Preserve the deliberate architecture: Windows and Ubuntu live on separate physical drives, each with its own ESP/bootloader; OS selection uses the firmware F11 menu. Do not unify them through a shared ESP or GRUB menu.
3. Keep `GRUB_DISABLE_OS_PROBER=true`. Never install GRUB to the Windows ESP or place Microsoft boot files on the Ubuntu ESP.
4. For duplicate Ubuntu firmware entries, remove stray `EFI/ubuntu` files from foreign ESPs first, then remove NVRAM entries, then set boot order. Firmware can recreate entries while stray files remain.
5. For recovery, identify and mount the verified Ubuntu root and Ubuntu-owned ESP, chroot with required bind mounts, then rebuild initramfs/GRUB only against those verified mounts.
6. Stop and ask before any formatting, partition deletion, bootloader installation, or foreign-ESP file removal. Prefer a dry-run command list first.

## Pitfalls
- Nine-drive NVMe enumeration can shift; remembered `/dev/nvme*` mappings are unsafe.
- NTFS data partitions may share OS disks and are not boot contamination.
- `efibootmgr -B` alone does not persist if firmware rediscovers foreign `EFI/ubuntu` files.
- Keyboard failure in initramfs can indicate missing USB-HID modules; it does not prove the root partition is wrong.
- Secure Boot is intentionally disabled for the current ROCm/module setup.

## Verification
1. Before mutation, capture device-to-UUID/ESP evidence and identify which physical disk owns each ESP.
2. After approved recovery, verify exactly one Windows Boot Manager and one Ubuntu entry, each pointing to its own disk.
3. Confirm `/boot/efi` is the Ubuntu disk's ESP and both OSes still boot independently through firmware selection.
