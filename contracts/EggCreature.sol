// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/// @title EggCreature
/// @notice Jede Wallet kann sich genau ein Ei minten (claim). Nur der Contract-Owner
/// (also wir als Betreiber) darf ein Ei füttern (feed) und so sein Level erhöhen.
/// Die Metadaten (Name + Level) werden einfach on-chain als Base64-JSON erzeugt,
/// es wird kein externer Metadaten-Server benötigt.
contract EggCreature is ERC721, Ownable {
    using Strings for uint256;

    uint256 private _nextTokenId;

    // tokenId => aktuelles Level
    mapping(uint256 => uint256) public levelOf;

    // Wallet-Adresse => hat bereits ein Ei geclaimt?
    mapping(address => bool) public hasClaimed;

    // Wallet-Adresse => darf füttern (zusätzlich zum Owner).
    // Eine Feeder-Wallet darf AUSSCHLIESSLICH feed() aufrufen - sonst nichts,
    // z.B. kann sie keine weiteren Feeder hinzufügen oder den Owner ändern.
    mapping(address => bool) public isFeeder;

    event FeederUpdated(address indexed feeder, bool allowed);

    constructor() ERC721("EggCreature", "EGG") Ownable(msg.sender) {}

    modifier onlyFeeder() {
        require(
            msg.sender == owner() || isFeeder[msg.sender],
            "Nicht berechtigt zu fuettern"
        );
        _;
    }

    /// @notice Erlaubt/entzieht einer Wallet die Berechtigung, feed() aufzurufen.
    /// Nur der Contract-Owner darf Feeder verwalten.
    function setFeeder(address feeder, bool allowed) external onlyOwner {
        isFeeder[feeder] = allowed;
        emit FeederUpdated(feeder, allowed);
    }

    /// @notice Mintet genau ein Ei für die aufrufende Wallet. Level startet bei 0.
    /// Jede Wallet darf das nur einmal aufrufen.
    function claim() external {
        require(!hasClaimed[msg.sender], "Diese Wallet hat bereits ein Ei geclaimt");

        uint256 tokenId = _nextTokenId;
        _nextTokenId++;

        hasClaimed[msg.sender] = true;
        levelOf[tokenId] = 0;

        _safeMint(msg.sender, tokenId);
    }

    /// @notice Erhoeht das Level eines Eis um 1. Nur der Owner oder eine
    /// freigeschaltete Feeder-Wallet darf das aufrufen - keine beliebige Wallet.
    function feed(uint256 tokenId) external onlyFeeder {
        _requireOwned(tokenId);
        levelOf[tokenId] += 1;
    }

    /// @notice Liefert einfache on-chain Metadaten (Name + aktuelles Level) als
    /// Base64-codiertes JSON, passend zum ERC721-Metadaten-Standard.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        uint256 level = levelOf[tokenId];
        string memory name = string.concat("Egg #", tokenId.toString());

        string memory json = string.concat(
            '{"name":"', name, '",',
            '"description":"A Community Creatures egg that evolves as it is fed.",',
            '"attributes":[{"trait_type":"Level","value":', level.toString(), "}]}"
        );

        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}
