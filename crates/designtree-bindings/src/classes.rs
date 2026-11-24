//! Device classes (US-18.6): the kernel files its binding schemas in about
//! a hundred folders (`serial`, `iio`, `memory-controllers`), too many to
//! browse. The library groups them into the classes a bring-up engineer
//! thinks in: what the device is, not where its schema lives.

/// The classes, in the order the library lists them.
pub const CLASSES: &[(&str, &str)] = &[
    ("cpu", "CPU"),
    ("memory", "Memory"),
    ("clock-reset", "Clock and reset"),
    ("power", "Power"),
    ("interrupt-dma", "Interrupts and DMA"),
    ("bus", "Bus"),
    ("serial", "Serial and messaging"),
    ("gpio", "GPIO, pins and LEDs"),
    ("storage", "Storage"),
    ("network", "Network"),
    ("display", "Display and video"),
    ("audio", "Audio"),
    ("sensor", "Sensor"),
    ("input", "Input"),
    ("security", "Security"),
    ("platform", "SoC and platform"),
    ("other", "Other"),
];

/// The class of a schema, from its folder (`category`) and, for the folders
/// that mix classes, its file name.
pub fn device_class(category: &str, path: &str) -> &'static str {
    let file = path.rsplit('/').next().unwrap_or(path);
    match category {
        // `arm/cpus.yaml`, `riscv/cpus.yaml` beside the architecture's
        // boards, PSCI and debug blocks.
        "arm" | "riscv" | "mips" | "powerpc" | "arc" | "csky" | "loongarch" | "nios2" | "x86"
            if file.contains("cpu") =>
        {
            "cpu"
        }
        "cpu" | "cpus" | "opp" | "cache" | "numa" | "perf" | "dvfs" => "cpu",
        "memory-controllers" | "reserved-memory" | "sram" | "nvmem" | "eeprom" | "pmem"
        | "edac" | "fuse" => "memory",
        "clock" | "reset" | "timer" | "hwlock" | "watchdog" => "clock-reset",
        "power" | "regulator" | "thermal" | "cpufreq" | "interconnect" | "charger" => "power",
        "interrupt-controller" | "dma" | "iommu" => "interrupt-dma",
        "bus" | "i2c" | "i3c" | "spi" | "pci" | "usb" | "slimbus" | "soundwire" | "spmi"
        | "fsi" | "peci" | "w1" | "mux" | "isa" | "pci-ep" | "virtio" => "bus",
        "serial" | "mailbox" | "hsi" | "ipmi" | "remoteproc" | "rpmsg" | "dsp" | "firmware" => {
            "serial"
        }
        "gpio" | "pinctrl" | "pwm" | "leds" => "gpio",
        "ata" | "mmc" | "mtd" | "nvme" | "ufs" | "scsi" => "storage",
        "net" | "infiniband" | "phy" | "gnss" | "nfc" | "wireless" | "can" => "network",
        "display" | "gpu" | "media" | "auxdisplay" | "backlight" => "display",
        "sound" => "audio",
        "iio" | "hwmon" | "rtc" | "hwinfo" => "sensor",
        "input" | "extcon" | "connector" => "input",
        "crypto" | "rng" | "tpm" | "security" => "security",
        "soc" | "mfd" | "arm" | "riscv" | "mips" | "powerpc" | "arc" | "csky" | "loongarch"
        | "nios2" | "x86" | "xen" | "goldfish" | "options" | "chosen" => "platform",
        _ => "other",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folders_map_to_classes() {
        assert_eq!(device_class("serial", "serial/8250.yaml"), "serial");
        assert_eq!(device_class("iio", "iio/adc/ti,ads1015.yaml"), "sensor");
        assert_eq!(device_class("arm", "arm/cpus.yaml"), "cpu");
        assert_eq!(device_class("arm", "arm/psci.yaml"), "platform");
        assert_eq!(
            device_class("clock", "clock/fixed-clock.yaml"),
            "clock-reset"
        );
        assert_eq!(device_class("misc", "trivial-devices.yaml"), "other");
    }

    #[test]
    fn every_class_is_listed() {
        for c in ["cpu", "memory", "sensor", "platform", "other"] {
            assert!(CLASSES.iter().any(|(id, _)| *id == c));
        }
    }
}
